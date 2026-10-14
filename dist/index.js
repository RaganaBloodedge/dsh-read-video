// dsh-readvideo —— DeepSeek Harness 插件入口（骨架版：先只有 video_probe）。
//
// 职责很窄：把"按需取字节理解视频"的能力暴露成模型可调用的工具。
// 重的逻辑（Range 取数、容器索引解析、ffmpeg 解帧、拼图）后续放进 src/video/，
// 本文件只负责按 dsh 插件规范挂载。
//
// 本地开发：  照 cordis.example.yml 填好绝对路径，再
//             dsh --profile web --patch "<填好的清单>"
// 持久挂载：  把清单里的 `- insert:` 块粘进 ~/.dsh/profiles/<name>/cordis.patch.yml
// 发布：      发到 npm registry 后，在 dsh 的插件页输入包名 dsh-readvideo 即可安装
//             （管理器会读 package.json 的 dsh.bundle.patch 自动写 profile 配置）
//
// 两条硬规矩（违反了不报错，只是行为诡异）：
//   1. 只用具名导出，绝不 export default —— 默认导出会让加载器丢掉 inject 等元数据；
//   2. 模块顶层不留副作用，一切在 apply 内完成（插件会被反复挂载/卸载）。
import { defineTool } from '@deepseek-ai/dsh-tools';
export const name = 'dsh-readvideo';
/** 依赖的服务槽：框架会先备好 ctx.tools，再调用 apply */
export const inject = ['tools'];
/** 人类可读的字节数，仅用于 render 的展示文本 */
function humanBytes(n) {
    if (!Number.isFinite(n) || n < 0)
        return String(n);
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = n;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
    }
    return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}
export function apply(ctx, _config = {}) {
    // ctx.tools.register 返回卸载函数，插件卸载时由 Cordis 自动调用，无需手动清理。
    ctx.tools.register(defineTool({
        name: 'video_probe',
        description: 'Probe a video URL without downloading it: HTTP status, byte length, whether the server supports Range requests (Accept-Ranges), and content type. Call this first for any "look at this video" request — it decides whether later steps can seek to a specific time instead of streaming the whole file.',
        parameters: {
            url: {
                type: 'string',
                required: true,
                description: 'Video URL, or a page URL that contains one',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    url: { type: 'string' },
                    ok: { type: 'boolean' },
                    status: { type: 'number' },
                    contentType: { type: 'string' },
                    contentLength: { type: 'number' },
                    acceptRanges: { type: 'string' },
                    seekable: { type: 'boolean' },
                    error: { type: 'string' },
                },
            },
            render(_args, value) {
                const v = value;
                if (!v.ok) {
                    return [{ type: 'text', text: `probe failed: ${v.url}\n  ${v.error}` }];
                }
                const lines = [
                    `url: ${v.url}`,
                    `status: ${v.status}`,
                    `content-type: ${v.contentType}`,
                    `length: ${humanBytes(v.contentLength)}`,
                    `accept-ranges: ${v.acceptRanges || '(none)'}`,
                    `seekable: ${v.seekable ? 'yes — can jump to a timestamp' : 'no — server ignores Range, only sequential read'}`,
                ];
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        timeoutMs: 30_000,
        async execute(args, exec) {
            const url = String(args.url);
            try {
                const resp = await fetch(url, {
                    method: 'HEAD',
                    redirect: 'follow',
                    signal: exec.signal,
                });
                const acceptRanges = resp.headers.get('accept-ranges') ?? '';
                return {
                    url: resp.url || url,
                    ok: resp.ok,
                    status: resp.status,
                    contentType: resp.headers.get('content-type') ?? '',
                    contentLength: Number(resp.headers.get('content-length') ?? 0),
                    acceptRanges,
                    seekable: acceptRanges.toLowerCase().includes('bytes'),
                    error: '',
                };
            }
            catch (err) {
                return {
                    url,
                    ok: false,
                    status: 0,
                    contentType: '',
                    contentLength: 0,
                    acceptRanges: '',
                    seekable: false,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        },
    }));
}
