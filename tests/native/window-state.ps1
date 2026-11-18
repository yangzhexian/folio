param(
  [Parameter(Mandatory = $true)][int]$ApplicationProcessId,
  [ValidateSet('list', 'minimize', 'restore', 'maximize', 'resize', 'activate', 'close', 'hide')][string]$Action = 'list',
  [long]$WindowHandle = 0,
  [int]$Width = 0,
  [int]$Height = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class FolioNativeSmoke {
  public delegate bool EnumCallback(IntPtr hwnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback, IntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  public static List<long> Windows(int target) {
    var found = new List<long>();
    EnumWindows((hwnd, extra) => { uint pid; GetWindowThreadProcessId(hwnd, out pid); if (pid == target) found.Add(hwnd.ToInt64()); return true; }, IntPtr.Zero);
    return found;
  }
}
'@
[void][FolioNativeSmoke]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
if ($Action -ne 'list') {
  if ($WindowHandle -eq 0) { throw 'A scoped window handle is required.' }
  $target = [IntPtr]::new($WindowHandle)
  [uint32]$owner = 0
  [void][FolioNativeSmoke]::GetWindowThreadProcessId($target, [ref]$owner)
  if ($owner -ne $ApplicationProcessId) { throw 'Refusing to control a window outside the spawned test application.' }
  switch ($Action) {
    'minimize' { [void][FolioNativeSmoke]::ShowWindowAsync($target, 6) }
    'restore' { [void][FolioNativeSmoke]::ShowWindowAsync($target, 9) }
    'maximize' { [void][FolioNativeSmoke]::ShowWindowAsync($target, 3) }
    'hide' { [void][FolioNativeSmoke]::ShowWindowAsync($target, 0) }
    'resize' {
      if ($Width -lt 600 -or $Height -lt 420 -or $Width -gt 2400 -or $Height -gt 1800) { throw 'Unexpected synthetic test dimensions.' }
      if (![FolioNativeSmoke]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, $Width, $Height, 0x16)) { throw 'SetWindowPos failed.' }
    }
    'activate' { [void][FolioNativeSmoke]::SetForegroundWindow($target) }
    'close' { [void][FolioNativeSmoke]::PostMessage($target, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
  }
}
$windows = @([FolioNativeSmoke]::Windows($ApplicationProcessId) | ForEach-Object {
  $handle = [IntPtr]::new($_)
  $title = [Text.StringBuilder]::new(1024)
  [void][FolioNativeSmoke]::GetWindowText($handle, $title, $title.Capacity)
  $bounds = New-Object FolioNativeSmoke+Rect
  $client = New-Object FolioNativeSmoke+Rect
  [void][FolioNativeSmoke]::GetWindowRect($handle, [ref]$bounds)
  [void][FolioNativeSmoke]::GetClientRect($handle, [ref]$client)
  [ordered]@{
    handle = $_
    title = $title.ToString()
    visible = [FolioNativeSmoke]::IsWindowVisible($handle)
    minimized = [FolioNativeSmoke]::IsIconic($handle)
    maximized = [FolioNativeSmoke]::IsZoomed($handle)
    alwaysOnTop = ([FolioNativeSmoke]::GetWindowLongPtr($handle, -20).ToInt64() -band 8) -ne 0
    dpi = [FolioNativeSmoke]::GetDpiForWindow($handle)
    width = $bounds.Right - $bounds.Left
    height = $bounds.Bottom - $bounds.Top
    clientWidth = $client.Right - $client.Left
    clientHeight = $client.Bottom - $client.Top
  }
})
ConvertTo-Json -InputObject $windows -Depth 4 -Compress
