# A minute in Folio

The film follows Alex Chen preparing a fictional academic record. The selected record, its field order, and its two attachments persist across every action. The opening occupies three seconds, the working session fills the next 54, and the last three return to the cover. Use the measured action times in `public/session/manifest.json` when editing captions.

| Time | Action and visible result | Camera motivation |
| --- | --- | --- |
| 0–3 s | Open the Folio workspace. | A paper file jacket unfolds into the Folio window. |
| 3–6 s | Reveal the synthetic document number, then cover it again. | Settle on the active record while the eye control changes. |
| 6–11 s | Type `QQ号`, copy the matched field, and clear the query. | Move towards the search input as the result appears. Hold long enough to see the copy confirmation. |
| 11–21 s | Insert an Alias field under the full name, type its value, drag the new field to the top, and save. | Follow the editor into the centre, then pull back into the same record. |
| 21–25 s | Drag the synthetic contact-card PNG onto the selected record. | Follow the incoming file into the actual drop target and hold on the new attachment. |
| 25–28 s | Open the imported image and zoom in. | Grow the independent viewer from the attachment and let the card fill the reader. |
| 28–33 s | Pin the viewer, drag its title bar, then select Education in the main window underneath. | Pull back to show the moving child, the changed background record, and the retained foreground. |
| 33–38 s | Switch to the PDF and turn to its second page. | Ease into the document while retaining its toolbar. |
| 38–41 s | Copy the PDF path and close the viewer. | Follow the pointer from the viewer controls back into the library. |
| 41–49 s | Move Education to the top of the collection list, choose a book icon, rename it Learning, and save. | Move in on the ordered rows, then reveal the changed sidebar. |
| 49–57 s | Return to the record, select dark mode, then switch to Chinese. | Leave room for the full workspace so the two changes are easy to compare. |
| 57–60 s | Return to the cover. | Retrace the opening movement and resolve the original instrumental phrase. |

The Remotion composition follows the same pointer from the main window into the child viewer, with a paper palette and a macOS-style title bar. A chapter icon and sentence-case label sit in the upper right. The two subtitle lines are centered at the bottom, English above Chinese, with their wording shared by the WebVTT tracks.

The recorded interface runs the Folio frontend and standalone viewer entry point `/?view=preview` against a synthetic IPC fixture. The presentation shell represents native window stacking. The capture script checks the drop command, saved field, collection icon, pin state, and selection in the underlying window. It generates the PNG and PDF bytes locally.
