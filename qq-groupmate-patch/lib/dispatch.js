/**
 * 事件分发：今日老婆 / 塔罗等全员玩法优先，其次管理员命令，
 * 最后才进入对话流程。抽成独立模块，保证插件入口与自测脚本走同一条代码路径。
 */
import { extractMessage } from "./group.js";
/**
 * 构造事件分发函数。
 * @param deps - 会话管理器、命令处理器与日志。
 * @returns 可直接接到 OneBot 事件回调上的函数。
 */
export function createEventDispatcher(deps) {
    const { manager, commands, logger, getSelf, wife, tarot, prefix, config } = deps;
    // [local patch 2026-10-28] 静默忽略的测试消息（默认「冷落测试」），整条丢弃、不回复也不留日志
    const ignoreTexts = (Array.isArray(config?.ignoreTexts) ? config.ignoreTexts : ['冷落测试'])
        .map(item => String(item ?? '').trim()).filter(Boolean);
    const shouldIgnore = text => ignoreTexts.some(item => String(text ?? '').includes(item));
    return function dispatch(event) {
        if (event.post_type !== 'message')
            return;
        // 事件自带 self_id 优先：登录信息可能尚未返回。
        const selfId = event.self_id ?? getSelf();
        if (event.message_type === 'group') {
            const groupEvent = event;
            const { text } = extractMessage(groupEvent.message, selfId);
            if (text === '')
                return;
            if (shouldIgnore(text))
                return;
            void (async () => {
                try {
                    // 活跃池：每条群消息都记一次（今日老婆的抽取池靠它）。
                    wife?.observe(groupEvent);
                    // 全员玩法优先：今日老婆（关键词 + 前缀都认）、星羽塔罗（前缀命令）。
                    if (wife !== undefined && await wife.handleGroup(groupEvent, text, prefix))
                        return;
                    if (tarot !== undefined && await tarot.handleGroup(groupEvent, text, prefix))
                        return;
                }
                catch (error) {
                    logger.error('qq-groupmate: 玩法处理异常: %s', String(error));
                }
                const handled = await commands.handleGroup(groupEvent, text).catch((error) => {
                    logger.error('qq-groupmate: 命令处理异常: %s', String(error));
                    return true;
                });
                if (!handled)
                    manager.handleEvent(groupEvent);
            })();
            return;
        }
        if (event.message_type === 'private') {
            const privateEvent = event;
            const { text } = extractMessage(privateEvent.message, selfId);
            if (text === '')
                return;
            if (shouldIgnore(text))
                return;
            void (async () => {
                try {
                    if (tarot !== undefined && await tarot.handlePrivate(privateEvent, text, prefix))
                        return;
                }
                catch (error) {
                    logger.error('qq-groupmate: 玩法处理异常: %s', String(error));
                }
                const handled = await commands.handlePrivate(privateEvent, text).catch((error) => {
                    logger.error('qq-groupmate: 命令处理异常: %s', String(error));
                    return true;
                });
                if (!handled)
                    manager.handleEvent(privateEvent);
            })();
        }
    };
}
