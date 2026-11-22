param([Parameter(Mandatory = $true)][int]$targetProcessId)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FixtureWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int state);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
}
'@

$window = [Diagnostics.Process]::GetProcessById($targetProcessId).MainWindowHandle
if ($window -eq [IntPtr]::Zero) { throw 'E2E main window is unavailable' }
# CDP can interact with a hidden window. Native capture needs a visible fixture.
[void][FixtureWindow]::ShowWindow($window, 5)
if (-not [FixtureWindow]::SetWindowPos($window, [IntPtr](-1), 0, 0, 0, 0, 0x53)) { throw 'Cannot show E2E fixture above desktop windows' }
[void][FixtureWindow]::SetForegroundWindow($window)
[void][FixtureWindow]::DwmFlush()
if (-not [FixtureWindow]::IsWindowVisible($window)) { throw 'E2E main window is not visible' }
