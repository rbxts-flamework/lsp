/**
 * Language service plugin
 */

"use strict";

import {} from "ts-expose-internals";
import * as ts from "typescript";
import { createProxy } from "./util/functions/createProxy";
import { Provider } from "./util/provider";
import { Config, PluginCreateInfo } from "./types";
import { getCompletionsAtPositionFactory } from "./languageService/getCompletionsAtPosition";
import { getCompletionEntryDetailsFactory } from "./languageService/getCompletionEntryDetails";
import { isFlameworkProject } from "./util/functions/isFlameworkProject";
import { getQuickInfoAtPositionFactory } from "./languageService/getQuickInfoAtPosition";

export = function init(modules: { typescript: typeof ts }) {
	const ts = modules.typescript;
	let provider: Provider;
	function create(info: PluginCreateInfo) {
		const service = info.languageService;
		if (!isFlameworkProject(ts, info)) {
			// This project does not depend on @flamework/core, so skip instantiation.
			console.log("Flamework language extensions has skipped loading in non-rbxts project.");
			return service;
		}

		const serviceProxy = createProxy(service);
		provider = new Provider(serviceProxy, service, info, ts);

		serviceProxy["getCompletionsAtPosition"] = getCompletionsAtPositionFactory(provider);
		serviceProxy["getCompletionEntryDetails"] = getCompletionEntryDetailsFactory(provider);
		serviceProxy["getQuickInfoAtPosition"] = getQuickInfoAtPositionFactory(provider);

		// If flamework-lsp fails, this code will fallback to the original method.
		// If this isn't a Flamework project, this code will fallback to the original method.
		for (const key in serviceProxy) {
			const method = (serviceProxy as any)[key];
			const originalMethod = (service as any)[key];
			if (method && originalMethod) {
				(serviceProxy as any)[key] = function () {
					try {
						return method.apply(service, arguments);
					} catch (err) {
						if (err instanceof Error) {
							console.error(`[Flamework error] ${key}`, `${err.stack ?? err.message}`);
						}
					}
					return originalMethod.apply(service, arguments);
				};
			}
		}

		// Add any unimplemented default methods.
		serviceProxy.addProxyMethods();

		provider.log("Flamework language extensions has loaded.");
		return serviceProxy;
	}

	function onConfigurationChanged(config: Config) {
		provider.config = config;
	}

	return { create, onConfigurationChanged };
};
