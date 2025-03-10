import type { AstroConfig, AstroSettings, AstroUserConfig } from '../../@types/astro';
import { SUPPORTED_MARKDOWN_FILE_EXTENSIONS } from './../constants.js';

import { fileURLToPath, pathToFileURL } from 'url';
import jsxRenderer from '../../jsx/renderer.js';
import { createDefaultDevConfig } from './config.js';
import { loadTSConfig } from './tsconfig.js';

export function createBaseSettings(config: AstroConfig): AstroSettings {
	return {
		config,
		tsConfig: undefined,
		tsConfigPath: undefined,

		adapter: undefined,
		injectedRoutes: [],
		pageExtensions: ['.astro', '.html', ...SUPPORTED_MARKDOWN_FILE_EXTENSIONS],
		renderers: [jsxRenderer],
		scripts: [],
		watchFiles: [],
		forceDisableTelemetry: false,
	};
}

export function createSettings(config: AstroConfig, cwd?: string): AstroSettings {
	const tsconfig = loadTSConfig(cwd);
	const settings = createBaseSettings(config);

	const watchFiles = tsconfig?.exists ? [tsconfig.path, ...tsconfig.extendedPaths] : [];

	if (cwd) {
		watchFiles.push(fileURLToPath(new URL('./package.json', pathToFileURL(cwd))));
	}

	settings.tsConfig = tsconfig?.config;
	settings.tsConfigPath = tsconfig?.path;
	settings.watchFiles = watchFiles;
	return settings;
}

export async function createDefaultDevSettings(
	userConfig: AstroUserConfig = {},
	root?: string | URL
): Promise<AstroSettings> {
	if (root && typeof root !== 'string') {
		root = fileURLToPath(root);
	}
	const config = await createDefaultDevConfig(userConfig, root);
	return createBaseSettings(config);
}
