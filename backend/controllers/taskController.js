const Task = require('../models/Task');
const { create } = require('../models/User');

//@desc  Get all tasks (Admin: all, User: only assigned tasks)
//@route GET /api/task  
//@access Private
const getTasks = async (req, res) => {
    try {
        const { status } = req.query;
        let filter = {};

        if (status){
            filter.status = status;
        }

        let tasks;
        if (req.user.role === 'admin') {
            tasks = await Task.find(filter).populate('assignedTo', 'name email profileImageUrl');
        } else {
            tasks=await Task.find({ ...filter, assignedTo: req.user._id }).populate('assignedTo', 'name email profileImageUrl');
        }

        //add completed todochecklists count to each task
        tasks = await Promise.all(
            tasks.map(async (task) => {
                const completedTodoCount = task.todoChecklist.filter(item => item.completed).length;
                return { ...task._doc, completedTodoCount };
            })
        );

        //status summary counts
        const allTasks = await Task.countDocuments(
            req.user.role === 'admin' ? {} : { assignedTo: req.user._id }
        );
        const pendingTasks = await Task.countDocuments({ 
            ...filter, status: "Pending",
            ...(req.user.role !== 'admin' && { assignedTo: req.user._id }),
        });
        const inProgressTasks = await Task.countDocuments({ 
            ...filter, status: "In Progress", 
            ...(req.user.role !== 'admin' && { assignedTo: req.user._id }),
        });
        const completedTasks = await Task.countDocuments({ ...filter, status: "Completed", 
            ...(req.user.role !== 'admin' && { assignedTo: req.user._id }),
        });

        res.json({
            tasks,
            statusSummary: {
                all: allTasks,
                pendingTasks,
                inProgressTasks,
                completedTasks,
            },
        });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
};

//@desc  Get task by ID
//@route GET /api/task/:id  
//@access Private
const getTaskById = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id).populate('assignedTo', 'name email profileImageUrl');
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }
        res.json(task);
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
};

//@desc  Create a new task (Admin only)
//@route POST /api/task  
//@access Private/Admin 
const createTask = async (req, res) => {
    try {
        const {
            title,
            description,
            dueDate,
            priority,
            assignedTo,
            todoChecklist,
            attachments,
        } = req.body;

        if (!Array.isArray(assignedTo) || assignedTo.length === 0) {
            return res.status(400).json({ message: "assignedTo must be a non-empty array of user IDs" });
        }
        const task = await Task.create({
            title,
            description,
            dueDate,    
            priority,
            assignedTo,
            createdBy: req.user._id,
            attachments,
            todoChecklist,
            status: "Pending",
        });
        res.status(201).json({ message: "Task created successfully", task });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }   
};  

//@desc  Update a task
//@route PUT /api/task/:id  
//@access Private   
const updateTask = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }
        task.title = req.body.title || task.title;
        task.description = req.body.description || task.description;
        task.dueDate = req.body.dueDate || task.dueDate;
        task.priority = req.body.priority || task.priority;
        task.attachments = req.body.attachments || task.attachments;
        task.todoChecklist = req.body.todoChecklist || task.todoChecklist;
        
        if (req.body.assignedTo) {
            if (!Array.isArray(req.body.assignedTo) || req.body.assignedTo.length === 0) {
                return res.status(400).json({ message: "assignedTo must be a non-empty array of user IDs" });
            }
            task.assignedTo = req.body.assignedTo;
        }

        const updatedTask = await task.save();
        res.json({ message: "Task updated successfully", updatedTask });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
};

//@desc  Delete a task (Admin only)
//@route DELETE /api/task/:id  
//@access Private/Admin 
const deleteTask = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }
        await task.deleteOne();
        res.json({ message: "Task deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
};

//@desc  Update task status
//@route PUT /api/task/:id/status  
//@access Private       
const updateTaskStatus = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }  
        const isAssigned = task.assignedTo.some(
            (userId) => userId.toString() === req.user._id.toString()
        );
        if (!isAssigned && req.user.role !== 'admin') {
            return res.status(403).json({ message: "Not authorized to update this task's status" });
        }
        task.status = req.body.status || task.status;
        if(task.status === "Completed"){
            task.todoChecklist.forEach(item => item.completed = true);
            task.progress = 100;
        }

        await task.save();
        res.json({ message: "Task status updated successfully", task });

    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
};

//@desc  Update task checklist (todo items)
//@route PUT /api/task/:id/todo  
//@access Private       
const updateTaskChecklist = async (req, res) => {
    try {
        const { todoChecklist } = req.body;
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }
        if(!task.assignedTo.includes(req.user._id) && req.user.role !== 'admin'){
            return res.status(403).json({ message: "Not authorized to update this task's checklist" });
        }

        task.todoChecklist = todoChecklist;

        //Auto-update progress based on completed todo items
        const completedCount = todoChecklist.filter(item => item.completed).length;
        const totalItems  = todoChecklist.length;
        task.progress = totalItems === 0 ? 0 : Math.round((completedCount / totalItems) * 100);

        //Auto-mark task as cmpleted if all items are checked
        if (task.progress === 100) {
            task.status = "Completed";
        }else if (task.progress > 0 && task.progress < 100) {
            task.status = "In Progress";
        }else{
            task.status = "Pending";
        }
        await task.save();
        const updatedTask = await Task.findById(req.params.id).populate('assignedTo', 'name email profileImageUrl');
        res.json({ message: "Task checklist updated", updatedTask });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
}; 

//@desc  Get dashboard data (Admin)
//@route GET /api/task/dashboard-data  
//@access Private/Admin
const getDashboardData = async (req, res) => {
    try {
        const totalTasks = await Task.countDocuments();
        const pendingTasks = await Task.countDocuments({ status: "Pending" });
        const completedTasks = await Task.countDocuments({ status: "Completed" });
        const overdueTasks = await Task.countDocuments({ dueDate: { $lt: new Date() }, status: { $ne: "Completed" } });

        //Ensure all possible statuses are represented
        const taskStatuses = ["Pending", "In Progress", "Completed"];
        const taskDistributionRaw = await Task.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);
        const taskDistribution = taskStatuses.reduce((acc, status) => {
            const formattedKey = status.replace(/\s+/g, "");
            acc[formattedKey] = 
                taskDistributionRaw.find(item => item._id === status)?.count || 0;
            return acc;
        }, {});

        taskDistribution["All"] = totalTasks; //add total count

        //Ensure all priority levels are represented
        const taskPriorities = ["Low", "Medium", "High"];
        const taskPriorityLevelsRaw = await Task.aggregate([
            { $group: { _id: "$priority", count: { $sum: 1 } } }
        ]);
        const taskPriorityLevels = taskPriorities.reduce((acc, priority) => {
            acc[priority] = 
                taskPriorityLevelsRaw.find(item => item._id === priority)?.count || 0;
            return acc;
        }, {});

        //fetch recent 10 tasks
        const recentTasks = await Task.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('assignedTo', 'name email profileImageUrl');
        res.json({
            statistics: {
                totalTasks,
                pendingTasks,
                completedTasks, 
                overdueTasks,
            },
            charts: {
                taskDistribution,
                taskPriorityLevels,
            },
            recentTasks,
        });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }   
};  

//@desc  Get dashboard data (User)
//@route GET /api/task/user-dashboard-data  
//@access Private
const getUserDashboardData = async (req, res) => {
    try {
        const userId = req.user._id; //only fetch for logged-in user

        //fetch statistics for user-specific tasks
        const totalTasks = await Task.countDocuments({ assignedTo: userId });
        const pendingTasks = await Task.countDocuments({ assignedTo: userId, status: "Pending" });
        const completedTasks = await Task.countDocuments({ assignedTo: userId, status: "Completed" });
        const overdueTasks = await Task.countDocuments({ 
            assignedTo: userId,
            dueDate: { $lt: new Date() },
            status: { $ne: "Completed" }
        });

        //Task distribution by status
        const taskStatuses = ["Pending", "In Progress", "Completed"];
        const taskDistributionRaw = await Task.aggregate([
            { $match: { assignedTo: userId } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        const taskDistribution = taskStatuses.reduce((acc, status) => {
            const formattedKey = status.replace(/\s+/g, "");
            acc[formattedKey] = 
                taskDistributionRaw.find(item => item._id === status)?.count || 0;
            return acc;
        }, {});
        taskDistribution["All"] = totalTasks; //add total count

        //Task distribution by priority
        const taskPriorities = ["Low", "Medium", "High"];
        const taskPriorityLevelsRaw = await Task.aggregate([
            { $match: { assignedTo: userId } },
            { $group: { _id: "$priority", count: { $sum: 1 } } }
        ]);

        const taskPriorityLevels = taskPriorities.reduce((acc, priority) => {
            acc[priority] = 
                taskPriorityLevelsRaw.find(item => item._id === priority)?.count || 0;
            return acc;
        }, {});

        //fetch recent 10 tasks
        const recentTasks = await Task.find({ assignedTo: userId })
            .sort({ createdAt: -1 })
            .limit(10)
            .select('title status dueDate priority createdAt');

            res.status(200).json({
                statistics: {
                    totalTasks,
                    pendingTasks,
                    completedTasks, 
                    overdueTasks,   
                },
                charts: {   
                    taskDistribution,
                    taskPriorityLevels,
                },
                recentTasks,
            });

    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }   
};

module.exports = {
    getTasks,
    getTaskById, 
    createTask,
    updateTask,
    deleteTask,
    updateTaskStatus,
    updateTaskChecklist,
    getDashboardData,
    getUserDashboardData
};