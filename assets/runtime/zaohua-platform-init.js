/**
 * 造化平台运行时初始化入口（非 Pack 文件）。
 * Game Builder 的生产构建会编译本模块，并在引擎 bundle 之前 await initialize() 完成。
 * 当前工程是空白场景，未声明任何平台能力；接入多人联机时再加 game.multiplayer。
 */
import { initialize } from 'zaohua-platform-sdk';

await initialize({ capabilities: [] });
