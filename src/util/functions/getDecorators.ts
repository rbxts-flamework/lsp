import ts from "typescript";

export function getDecorators(node?: ts.Node) {
	if (ts.canHaveDecorators === undefined) return node?.decorators;

	return node && ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
}
