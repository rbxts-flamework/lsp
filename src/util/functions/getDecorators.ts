import type ts from "typescript";
import { Provider } from "../provider";

export function getDecorators(provider: Provider, node?: ts.Node) {
	const { ts } = provider;
	if (ts.canHaveDecorators === undefined) return node?.decorators;

	return node && ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
}
