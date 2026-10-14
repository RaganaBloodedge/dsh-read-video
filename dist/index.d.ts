import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-readvideo";
/** 依赖的服务槽：框架会先备好 ctx.tools，再调用 apply */
export declare const inject: string[];
export interface Config {
    /** ffmpeg 可执行文件路径；留空 = 自动发现（后续阶段用） */
    ffmpegPath?: string | null;
    /** 缓存目录；留空 = <cwd>/.read-video-cache */
    cacheDir?: string | null;
    /** 语音识别后端：local = dsh 的 ctx.speechToText，cloud = 自配 API */
    asrProvider?: 'local' | 'cloud';
}
export declare function apply(ctx: Context, _config?: Config): void;
