# Interface and language

Folio opens in light sage. Keep the current three-pane hierarchy, system font stack with Segoe UI and Microsoft YaHei fallbacks, and Lucide icons. Select colors by role from the theme variables for text, subdued text, surface, border, emphasis, focus, selection, favorite and danger. A category swatch conveys identity. Selected, disabled and focused controls must remain distinguishable with any accent.

| Intent | Visual and interaction contract |
| --- | --- |
| Return or close | Return goes to the previous context. Close dismisses the current surface. Use the OS title bar for the detached preview. Escape in a nested dialog closes the top dialog and focus returns to the opener. |
| Choose or toggle | Use a select for an ordered set of choices. An icon toggle exposes its state through a translated accessible name or pressed state. Keep the theme selection ring centered on the color swatch. |
| Move or navigate | Previous/next arrows follow their sequence. Distinguish attachment navigation, PDF paging and month/year controls in accessible names. Dragging fields and collections has keyboard or move-button equivalents. |
| Commit or dismiss | Use the existing save/cancel layout. Reserve the destructive treatment for removal. Keep insertion controls aligned below their field and notifications clear of the bottom edge and preview toolbar. |
| Text and icons | English controls use sentence case. Preserve proper names and acronyms such as Folio, PDF and CLI. Use sentence punctuation or spacing, and avoid decorative separators. Translate labels, tooltips, empty states and error recovery together. |

Use the controls in `src/ui/Buttons.tsx`, the dialog behavior in `src/ui/Modal.tsx` and the scales in `src/ui/tokens.css`. Choose an existing compact, toolbar or dialog size before introducing a new value. Keep the primary action reachable at 900 × 620 in the main window and 600 × 420 in the child. Desktop controls need a visible keyboard focus state, readable text, unclipped labels and accessible names in both languages.

| English | 中文 | Usage |
| --- | --- | --- |
| Save changes | 保存更改 | Apply an edit |
| Cancel | 取消 | Leave the current edit |
| Close | 关闭 | Dismiss a surface |
| Copy | 复制 | Copy the specified value |
| Previous attachment / Next attachment | 上一个附件 / 下一个附件 | Navigate within the active preview selection |

Use the feature's current dictionary keys when extending the glossary. Test both languages, long filenames and values, all five accents in light and dark modes, and keyboard focus. Check the difference between masked search results, explicit single-value copying and copying an entire record.
