# Folio backend CLI

The CLI is a local executable shipped beside Folio. It does not launch the desktop interface or expose a network port. Use its `schema` command to check the installed version's exact contract.

## Invocation

```powershell
$folioCli = 'D:\Apps\Folio\folio-cli.exe'
$folioData = 'D:\Apps\Folio\data'
& $folioCli --data-dir $folioData info
& $folioCli schema
& $folioCli --data-dir $folioData list
& $folioCli --data-dir $folioData validate --input 'D:\PrivateWork\record.json'
& $folioCli --data-dir $folioData create --input 'D:\PrivateWork\record.json'
& $folioCli --data-dir $folioData get --id '30a81577-b68d-449a-9d4a-0b1c5398b231'
```

These paths and the UUID are illustrative. Resolve the actual executable and library, and generate a new UUID for each genuinely new record. Read-only commands and validation do not initialize an empty vault. Creation can initialize the explicitly chosen data directory.

On an explicitly selected new library, `info` reports `libraryExists: false`, and `list` or `get` returns `LIBRARY_NOT_FOUND` with exit code 1. This is expected before the first successful `create`. If the user intended an existing library, correct the path instead of creating an empty replacement.

| Command | Effect |
| --- | --- |
| `info` | Report the resolved data directory and whether a library exists. |
| `schema` | Describe accepted record and attachment inputs. |
| `list` | List active record summaries. |
| `get --id UUID` | Read an active record and its attachments. |
| `validate --input FILE` | Validate a record payload without writing the library. |
| `create --input FILE` | Create a new record; reject an existing ID. |
| `update --input FILE --expected-updated-at VALUE` | Replace an active record only if its stored revision still matches. |
| `attach --record-id UUID --input FILE` | Import the JSON array of local source paths into that record. |

## Record payload

```json
{
  "id": "30a81577-b68d-449a-9d4a-0b1c5398b231",
  "category": "contacts",
  "title": "Example contact",
  "subtitle": "Synthetic skill example",
  "tags": ["Example"],
  "favorite": false,
  "notes": "",
  "fields": [
    {
      "id": "email",
      "label": "Email",
      "labelZh": "邮箱",
      "value": "example@example.invalid",
      "kind": "email",
      "sensitive": false
    }
  ]
}
```

The backend manages creation and modification timestamps. For updates, retain the exact `updatedAt` returned by `get` as the `--expected-updated-at` value, rather than generating one or changing its formatting. Existing timestamps in a fetched record do not authorize an overwrite by themselves.

PowerShell can convert JSON timestamps to `DateTime` values and change their formatting. In PowerShell 7.5 or newer, use `ConvertFrom-Json -DateKind String` to retain the exact revision. In older shells, use a JSON parser that preserves strings, such as Node.js `JSON.parse` or Python `json.loads`, instead of converting a timestamp back from a date object.

```powershell
$raw = & $folioCli --data-dir $folioData get --id $recordId
if ($LASTEXITCODE -ne 0) { throw 'Could not read the current record.' }
$reply = $raw | ConvertFrom-Json -DateKind String
$expectedRevision = $reply.data.record.updatedAt
$record = $reply.data.record
# Modify only the requested properties, then serialize the complete record as UTF-8 JSON.
# Pass $expectedRevision unchanged to update --expected-updated-at.
```

Categories are `identity`, `education`, `experience`, `research`, `awards`, `skills`, `contacts`, `documents`, and `custom`. Field kinds are `text`, `multiline`, `date`, `email`, `phone`, and `url`. Record IDs use canonical lowercase UUIDs. Field IDs are unique, nonempty strings within their record; preserve existing IDs when changing values or order. Consult `schema` for current size and validation limits.

An attachment payload is a JSON array such as `["D:\\Documents\\example-certificate.pdf", "D:\\Pictures\\example-portrait.png"]`. Pass local regular files, not directories, URLs, network shares, or Windows alternate streams. The importer accepts at most 100 paths per command and 2 GiB per file, preserves the original source files, and rejects unsafe sources. It may copy a previously imported source again if explicitly invoked again.

## Results and recovery

Success is JSON on stdout with `ok: true`, `command`, and `data`. Failure is JSON on stderr with `ok: false` and `error.code` / `error.message`. Exit 0 means success, 2 means invalid command usage, 3 means a record or revision conflict, and other failures use exit 1. Check the exit code before parsing a success result.

After an unknown create outcome, read the same UUID and compare the requested contents. An existing ID is not proof that this attempt succeeded. After an unknown attachment outcome, inspect the record's attachment list before deciding whether any files remain to import. Do not retry an entire record-plus-attachment workflow as though it were one transaction.

If an update conflicts, keep the proposed values, read the current record, and merge only changes authorized by the user. Preserve unrelated new fields and attachments. A local busy result means another Folio operation holds the library lock; wait for that operation and retry within the user's task scope. Stop and report a persistent failure instead of looping indefinitely or bypassing backend checks.
