const { spawn } = require('child_process');

const READ_TIMEOUT_MS = 12_000;

// This uses UI Automation's read-only Text/Value patterns. It does not send
// input, move focus, scroll, select text, or touch the clipboard.
const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
function Safe-Number($value) {
  $number = [double]$value
  if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return 0.0 }
  return $number
}
$handleValue = [Int64]::Parse($env:OVERLAY_TARGET_HWND)
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($handleValue))
if ($null -eq $root) { throw 'Could not access the target window through UI Automation.' }
$rootRect = $root.Current.BoundingRectangle
$rootBounds = @{ x = Safe-Number $rootRect.X; y = Safe-Number $rootRect.Y; width = Safe-Number $rootRect.Width; height = Safe-Number $rootRect.Height }
$items = New-Object System.Collections.Generic.List[object]
$totalChars = 0
$tree = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
for ($i = 0; $i -lt $tree.Count -and $items.Count -lt 600 -and $totalChars -lt 250000; $i++) {
  $element = $tree.Item($i)
  try {
    $current = $element.Current
    $text = ''
    try {
      $pattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      if ($null -ne $pattern) { $text = $pattern.DocumentRange.GetText(-1) }
    } catch {}
    if ([string]::IsNullOrWhiteSpace($text)) {
      try {
        $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $valuePattern) { $text = $valuePattern.Current.Value }
      } catch {}
    }
    if ([string]::IsNullOrWhiteSpace($text) -and $current.ControlType -eq [System.Windows.Automation.ControlType]::Text) {
      $text = $current.Name
    }
    if ([string]::IsNullOrWhiteSpace($text)) { continue }
    $text = [string]$text
    $remaining = 250000 - $totalChars
    if ($text.Length -gt $remaining) { $text = $text.Substring(0, $remaining) }
    $rect = $current.BoundingRectangle
    $items.Add(@{
      controlType = $current.ControlType.ProgrammaticName
      name = [string]$current.Name
      automationId = [string]$current.AutomationId
      className = [string]$current.ClassName
      isOffscreen = [bool]$current.IsOffscreen
      bounds = @{ x = Safe-Number $rect.X; y = Safe-Number $rect.Y; width = Safe-Number $rect.Width; height = Safe-Number $rect.Height }
      text = $text
    })
    $totalChars += $text.Length
  } catch {}
}
$result = @{ bounds = $rootBounds; elements = @($items.ToArray()); truncated = ($totalChars -ge 250000 -or $items.Count -ge 600) }
$json = ConvertTo-Json -InputObject $result -Depth 8 -Compress
[Console]::Out.Write([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json)))
`;

function readWindowAccessibility(hwnd) {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Read-only accessibility capture is currently available on Windows only.'));
  }
  if (!/^\d+$/.test(String(hwnd || ''))) {
    return Promise.reject(new Error('The target window handle is invalid.'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', '-',
    ], {
      windowsHide: true,
      env: { ...process.env, OVERLAY_TARGET_HWND: String(hwnd) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), READ_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Could not start Windows accessibility reader: ${error.message}`));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || (code === null
          ? 'Accessibility read timed out.'
          : `Accessibility reader exited with code ${code}.`)));
        return;
      }
      try {
        const encoded = stdout.trim().split(/\r?\n/).pop();
        const snapshot = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        if (!Array.isArray(snapshot.elements)) throw new Error('Accessibility response had no element list.');
        resolve(snapshot);
      } catch (error) {
        reject(new Error(`Could not parse accessibility text: ${error.message}`));
      }
    });
    child.stdin.end(POWERSHELL_SCRIPT, 'utf8');
  });
}

function buildPanelText(snapshot) {
  const { bounds = {}, elements = [] } = snapshot || {};
  const midpoint = Number(bounds.x || 0) + Number(bounds.width || 0) / 2;
  const windowWidth = Number(bounds.width || 0);
  const candidates = elements
    .filter((element) => String(element.text || '').trim())
    .map((element) => ({
      ...element,
      text: String(element.text).replace(/\u0000/g, ''),
      centerX: Number(element.bounds?.x || 0) + Number(element.bounds?.width || 0) / 2,
      top: Number(element.bounds?.y || 0),
    }))
    .filter((element) => element.bounds?.width > 0 && element.bounds?.height > 0)
    // Ignore page-level text ranges spanning both panes. If the editor itself
    // exposes only a whole-window range, fail visibly rather than mislabeling
    // instructions as source code.
    .filter((element) => !windowWidth || element.bounds.width <= windowWidth * 0.88);

  function distinctLargest(items) {
    const selected = [];
    for (const item of [...items].sort((a, b) => b.text.length - a.text.length)) {
      const normalized = item.text.trim();
      if (!normalized || selected.some((existing) => existing.text.includes(normalized))) continue;
      selected.push(item);
    }
    return selected.sort((a, b) => a.top - b.top).map((item) => item.text.trim()).join('\n');
  }

  return {
    instructions: distinctLargest(candidates.filter((item) => item.centerX < midpoint)),
    code: distinctLargest(candidates.filter((item) => item.centerX >= midpoint)),
    candidateCount: candidates.length,
    truncated: Boolean(snapshot?.truncated),
    note: 'UI Automation text was read without moving focus, scrolling, typing, selecting, or using the clipboard. Full off-screen coverage is not guaranteed by this capture alone.',
  };
}

module.exports = { readWindowAccessibility, buildPanelText };

