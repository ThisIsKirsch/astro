import npath from 'node:path';
import { pathToFileURL } from 'url';
import type { Plugin } from 'vite';
import { moduleIsTopLevelPage, walkParentInfos } from '../core/build/graph.js';
import { BuildInternals, getPageDataByViteID } from '../core/build/internal.js';
import { AstroBuildPlugin } from '../core/build/plugin.js';
import type { StaticBuildOptions } from '../core/build/types';
import type { ModuleLoader } from '../core/module-loader/loader.js';
import { createViteLoader } from '../core/module-loader/vite.js';
import { prependForwardSlash } from '../core/path.js';
import { getStylesForURL } from '../core/render/dev/css.js';
import { getScriptsForURL } from '../core/render/dev/scripts.js';
import {
	contentFileExts,
	LINKS_PLACEHOLDER,
	PROPAGATED_ASSET_FLAG,
	SCRIPTS_PLACEHOLDER,
	STYLES_PLACEHOLDER,
} from './consts.js';

function isPropagatedAsset(viteId: string): boolean {
	const url = new URL(viteId, 'file://');
	return (
		url.searchParams.has(PROPAGATED_ASSET_FLAG) &&
		contentFileExts.some((ext) => url.pathname.endsWith(ext))
	);
}

export function astroContentAssetPropagationPlugin({ mode }: { mode: string }): Plugin {
	let devModuleLoader: ModuleLoader;
	return {
		name: 'astro:content-asset-propagation',
		enforce: 'pre',
		configureServer(server) {
			if (mode === 'dev') {
				devModuleLoader = createViteLoader(server);
			}
		},
		load(id) {
			if (isPropagatedAsset(id)) {
				const basePath = id.split('?')[0];
				const code = `
					export async function getMod() {
						return import(${JSON.stringify(basePath)});
					}
					export const collectedLinks = ${JSON.stringify(LINKS_PLACEHOLDER)};
					export const collectedStyles = ${JSON.stringify(STYLES_PLACEHOLDER)};
					export const collectedScripts = ${JSON.stringify(SCRIPTS_PLACEHOLDER)};
				`;
				return { code };
			}
		},
		async transform(code, id, options) {
			if (!options?.ssr) return;
			if (devModuleLoader && isPropagatedAsset(id)) {
				const basePath = id.split('?')[0];
				if (!devModuleLoader.getModuleById(basePath)?.ssrModule) {
					await devModuleLoader.import(basePath);
				}
				const { stylesMap, urls } = await getStylesForURL(
					pathToFileURL(basePath),
					devModuleLoader,
					'development'
				);

				const hoistedScripts = await getScriptsForURL(pathToFileURL(basePath), devModuleLoader);

				return {
					code: code
						.replace(JSON.stringify(LINKS_PLACEHOLDER), JSON.stringify([...urls]))
						.replace(JSON.stringify(STYLES_PLACEHOLDER), JSON.stringify([...stylesMap.values()]))
						.replace(JSON.stringify(SCRIPTS_PLACEHOLDER), JSON.stringify([...hoistedScripts])),
				};
			}
		},
	};
}

export function astroConfigBuildPlugin(
	options: StaticBuildOptions,
	internals: BuildInternals
): AstroBuildPlugin {
	let ssrPluginContext: any = undefined;
	return {
		build: 'ssr',
		hooks: {
			'build:before': ({ build }) => {
				return {
					vitePlugin: {
						name: 'astro:content-build-plugin',
						generateBundle() {
							if (build === 'ssr') {
								ssrPluginContext = this;
							}
						},
					},
				};
			},
			'build:post': ({ ssrOutputs, clientOutputs, mutate }) => {
				const outputs = ssrOutputs.flatMap((o) => o.output);
				for (const chunk of outputs) {
					if (
						chunk.type === 'chunk' &&
						(chunk.code.includes(LINKS_PLACEHOLDER) || chunk.code.includes(SCRIPTS_PLACEHOLDER))
					) {
						let entryCSS = new Set<string>();
						let entryScripts = new Set<string>();

						for (const id of Object.keys(chunk.modules)) {
							for (const [pageInfo] of walkParentInfos(id, ssrPluginContext)) {
								if (moduleIsTopLevelPage(pageInfo)) {
									const pageViteID = pageInfo.id;
									const pageData = getPageDataByViteID(internals, pageViteID);
									if (!pageData) continue;

									const _entryCss = pageData.propagatedStyles?.get(id);
									const _entryScripts = pageData.propagatedScripts?.get(id);
									if (_entryCss) {
										for (const value of _entryCss) {
											entryCSS.add(value);
										}
									}
									if (_entryScripts) {
										for (const value of _entryScripts) {
											entryScripts.add(value);
										}
									}
								}
							}
						}

						let newCode = chunk.code;
						if (entryCSS.size) {
							newCode = newCode.replace(
								JSON.stringify(LINKS_PLACEHOLDER),
								JSON.stringify([...entryCSS])
							);
						}
						if (entryScripts.size) {
							const entryFileNames = new Set<string>();
							for (const output of clientOutputs) {
								for (const clientChunk of output.output) {
									if (clientChunk.type !== 'chunk') continue;
									for (const [id] of Object.entries(clientChunk.modules)) {
										if (entryScripts.has(id)) {
											entryFileNames.add(clientChunk.fileName);
										}
									}
								}
							}
							newCode = newCode.replace(
								JSON.stringify(SCRIPTS_PLACEHOLDER),
								JSON.stringify(
									[...entryFileNames].map((src) => ({
										props: {
											src: prependForwardSlash(npath.posix.join(options.settings.config.base, src)),
											type: 'module',
										},
										children: '',
									}))
								)
							);
						}
						mutate(chunk, 'server', newCode);
					}
				}
			},
		},
	};
}
