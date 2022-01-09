import ts from "typescript";

export function createDiagnosticAtLocation(
	node: ts.Node,
	messageText: string,
	category: ts.DiagnosticCategory,
	file = ts.getSourceFileOfNode(node),
): ts.DiagnosticWithLocation {
	return {
		category,
		file,
		messageText,
		start: node.getStart(),
		length: node.getWidth(),
		code: "@flamework/core" as never,
	};
}
