import { omniLog } from "../../utils/logger.js";
import { evaluateOmnichannelRolloutForUser } from "./rolloutService.js";
import {
  getOmnichannelEvents,
  getOmnichannelMonitoringSummary,
} from "./omnichannelMonitoringService.js";

const parseBoolean = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

export const getOmnichannelSummary = async (req, res) => {
  try {
    const { windowMinutes = 15 } = req.query;
    const data = await getOmnichannelMonitoringSummary({ windowMinutes });

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    omniLog.error("getOmnichannelSummary failed", {
      userId: req.user?._id,
      error: error.message,
    });

    res.status(500).json({
      success: false,
      message: "Không thể lấy tổng quan monitoring omnichannel",
      error: error.message,
    });
  }
};

export const listOmnichannelEvents = async (req, res) => {
  try {
    const { limit = 100, minutes = 60, operation, level } = req.query;
    const success = parseBoolean(req.query.success);

    const events = await getOmnichannelEvents({
      limit,
      minutes,
      operation,
      level,
      success,
    });

    res.json({
      success: true,
      data: {
        events,
        total: events.length,
      },
    });
  } catch (error) {
    omniLog.error("listOmnichannelEvents failed", {
      userId: req.user?._id,
      error: error.message,
    });

    res.status(500).json({
      success: false,
      message: "Không thể lấy danh sách event omnichannel",
      error: error.message,
    });
  }
};

export const getOmnichannelRolloutDecision = async (req, res) => {
  try {
    const decision = evaluateOmnichannelRolloutForUser(req.user);

    res.json({
      success: true,
      data: decision,
    });
  } catch (error) {
    omniLog.error("getOmnichannelRolloutDecision failed", {
      userId: req.user?._id,
      error: error.message,
    });

    res.status(500).json({
      success: false,
      message: "Không thể lấy rollout decision",
      error: error.message,
    });
  }
};

export default {
  getOmnichannelSummary,
  listOmnichannelEvents,
  getOmnichannelRolloutDecision,
};
