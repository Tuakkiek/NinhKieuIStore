import Notification from "./Notification.js";

const buildRecipientFilter = (user) => {
  const clauses = [];

  if (user?._id) {
    clauses.push({ recipientUserId: user._id });
  }
  if (user?.role) {
    clauses.push({
      recipientRole: user.role,
      $or: [
        { recipientUserId: null },
        { recipientUserId: { $exists: false } },
      ],
    });
  }

  if (!clauses.length) {
    return { _id: null };
  }

  return { $or: clauses };
};

export const getMyNotifications = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      eventType,
      isRead,
    } = req.query;

    const filter = buildRecipientFilter(req.user);

    if (eventType) {
      filter.eventType = String(eventType).trim();
    }

    if (isRead !== undefined) {
      filter.isRead = String(isRead).toLowerCase() === "true";
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      notifications,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Không thể lấy thông báo",
      error: error.message,
    });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const filter = {
      _id: req.params.notificationId,
      ...buildRecipientFilter(req.user),
    };

    const notification = await Notification.findOneAndUpdate(
      filter,
      {
        $set: {
          isRead: true,
          readAt: new Date(),
          readBy: req.user?._id,
        },
      },
      { new: true }
    ).lean();

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thông báo",
      });
    }

    return res.json({
      success: true,
      notification,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Không thể đánh dấu đã đọc",
      error: error.message,
    });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    const filter = {
      ...buildRecipientFilter(req.user),
      isRead: false,
    };

    const result = await Notification.updateMany(filter, {
      $set: {
        isRead: true,
        readAt: new Date(),
        readBy: req.user?._id,
      },
    });

    return res.json({
      success: true,
      modifiedCount: result.modifiedCount || 0,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Không thể đánh dấu tất cả đã đọc",
      error: error.message,
    });
  }
};

export default {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
};
