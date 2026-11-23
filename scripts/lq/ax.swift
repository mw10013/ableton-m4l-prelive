// Live's accessibility tree, for `lq ax`. Compiled once by lq into node_modules/.cache/lq.
//
//   ax tree <window>                 indented lines: role, label, value
//   ax press <window> <label>        AXPress the first element with that label
//   ax set <window> <label> <value>  set a slider's or text field's value
//
// <window> is part of a window's title; "" is Live's main window. A label is an element's
// description, or its title when it has none. `Group/Label` scopes the search to a group.
import AppKit
import ApplicationServices

func attr(_ e: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(e, name as CFString, &value) == .success ? value : nil
}

func str(_ e: AXUIElement, _ name: String) -> String {
  guard let v = attr(e, name) else { return "" }
  if let s = v as? String { return s }
  if let n = v as? NSNumber { return n.stringValue }
  return ""
}

func children(_ e: AXUIElement) -> [AXUIElement] {
  (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

func label(_ e: AXUIElement) -> String {
  let d = str(e, kAXDescriptionAttribute)
  return d.isEmpty ? str(e, kAXTitleAttribute) : d
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

guard AXIsProcessTrusted() else { fail("no Accessibility permission") }
let args = CommandLine.arguments
guard args.count >= 3 else { fail("usage: ax tree|press|set <window> [label] [value]") }

let live = NSWorkspace.shared.runningApplications.first { $0.localizedName == "Live" }
guard let pid = live?.processIdentifier else { fail("Live is not running") }
let app = AXUIElementCreateApplication(pid)
let windows = (attr(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
let wanted = args[2].lowercased()
let window =
  wanted.isEmpty
  ? windows.first { !str($0, kAXTitleAttribute).contains("/") && str($0, kAXSubroleAttribute) == "AXStandardWindow" }
  : windows.first { str($0, kAXTitleAttribute).lowercased().contains(wanted) }
guard let window else {
  fail("no window \(args[2]); windows: \(windows.map { str($0, kAXTitleAttribute) }.joined(separator: ", "))")
}

func tree(_ e: AXUIElement, _ depth: Int, _ out: inout [String]) {
  let role = str(e, kAXRoleAttribute).replacingOccurrences(of: "AX", with: "")
  let l = label(e)
  let v = str(e, kAXValueAttribute)
  let kids = children(e)
  // Skip unlabeled wrappers; their children take their depth.
  if role == "Group" && l.isEmpty && v.isEmpty {
    for k in kids { tree(k, depth, &out) }
    return
  }
  // Text that only repeats its own label adds nothing.
  if role == "StaticText" && (v.isEmpty || v == l) && !l.isEmpty && kids.isEmpty {
    out.append(String(repeating: " ", count: depth) + l)
    return
  }
  var line = String(repeating: " ", count: depth) + role
  if !l.isEmpty { line += " \(l)" }
  if !v.isEmpty && v != l { line += " = \(v)" }
  out.append(line)
  for k in kids { tree(k, depth + 1, &out) }
}

/// The first element labeled with the path's last part, inside groups labeled with the earlier parts.
func find(_ e: AXUIElement, _ path: [String]) -> AXUIElement? {
  guard let first = path.first else { return e }
  for k in children(e) {
    if label(k).lowercased() == first.lowercased(), let hit = find(k, Array(path.dropFirst())) {
      return hit
    }
    if let hit = find(k, path) { return hit }
  }
  return nil
}

switch args[1] {
case "tree":
  var out: [String] = []
  tree(window, 0, &out)
  print(out.joined(separator: "\n"))
case "press", "set":
  guard args.count >= 4 else { fail("missing label") }
  guard let target = find(window, args[3].split(separator: "/").map(String.init)) else {
    fail("no element \(args[3])")
  }
  if args[1] == "press" {
    let r = AXUIElementPerformAction(target, kAXPressAction as CFString)
    guard r == .success else { fail("press failed: \(r.rawValue)") }
  } else {
    guard args.count >= 5 else { fail("missing value") }
    let value: CFTypeRef = Double(args[4]).map { NSNumber(value: $0) } ?? (args[4] as CFString)
    let r = AXUIElementSetAttributeValue(target, kAXValueAttribute as CFString, value)
    guard r == .success else { fail("set failed: \(r.rawValue)") }
  }
  print("\(label(target)) = \(str(target, kAXValueAttribute))")
default:
  fail("unknown command \(args[1])")
}
