import ts from "typescript";

export function getDecorators(node?: ts.Node) {
	return node && ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
}
