# Use MDXEditor for Markdown notes

MDXEditor is the selected foundation for visual editing and direct Markdown source editing. Its documented source mode and custom block facilities fit editable widget configuration and source repair without building a separate editor experience. Tiptap offers reuse of the existing HTML editor, but moving to its current Markdown support would require an upgrade and additional source-mode integration; Milkdown would also require more assembly for this workflow.

Use the library's conventional fallback for unsupported or malformed content, retaining source access for repair. Widget syntax remains open, with ordinary fenced blocks and a custom visual component as a candidate. Validate the required note content and iPhone interaction in an initial trial.

References: [source mode](https://mdxeditor.dev/editor/docs/diff-source), [custom code blocks](https://mdxeditor.dev/editor/docs/code-blocks).
