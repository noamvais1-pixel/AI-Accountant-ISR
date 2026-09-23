// אפליקציית מק עצמאית: חלון משלה, אייקון משלה ב-Dock, בלי דפדפן.
//
// החלון מציג את האפליקציה דרך WKWebView. תצוגת רשת חשופה משמיטה בשקט כמה
// דברים שדפדפן עושה מעצמו, ולכן הם ממומשים כאן במפורש:
// דיאלוגי אישור (מחיקת מסמך), בחירת קבצים (העלאת קבלות), הורדות (קובץ PCN874),
// וקישורים שנפתחים בחלון חדש (צפייה במסמך סרוק).

import AppKit
import WebKit

let appPort = 3737
let appURL = URL(string: "http://localhost:\(appPort)/")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var window: NSWindow!
  var webView: WKWebView!
  var server: Process?
  var childWindows: [NSWindow] = []
  let projectDir: String
  let logURL: URL

  init(projectDir: String) {
    self.projectDir = projectDir
    let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/AI Accountant")
    try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
    self.logURL = logs.appendingPathComponent("server.log")
  }

  /** יומן אירועים של החלון עצמו — הורדות וכשלים שאחרת לא משאירים שום עקבות. */
  func appLog(_ message: String) {
    let url = logURL.deletingLastPathComponent().appendingPathComponent("app.log")
    let line = "\(Date()) \(message)\n"
    if let handle = try? FileHandle(forWritingTo: url) {
      handle.seekToEndOfFile(); handle.write(line.data(using: .utf8)!); try? handle.close()
    } else {
      try? line.write(to: url, atomically: true, encoding: .utf8)
    }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()

    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    window.title = "רואה חשבון AI"
    window.minSize = NSSize(width: 720, height: 520)
    window.contentView = webView
    window.setFrameAutosaveName("MainWindow")
    if !window.setFrameUsingName("MainWindow") { window.center() }
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(webView)
    NSApp.activate(ignoringOtherApps: true)

    showStatus("מפעיל את המערכת…")

    DispatchQueue.global().async {
      if !self.isServerUp() { self.startServer() }
      // בנייה ראשונה אחרי שינוי קוד לוקחת עד כמה דקות
      for _ in 0..<300 {
        if self.isServerUp() {
          DispatchQueue.main.async { self.webView.load(URLRequest(url: appURL)) }
          return
        }
        if let s = self.server, !s.isRunning {
          DispatchQueue.main.async {
            self.showStatus("השרת לא עלה. פרטים ביומן:<br><code>\(self.logURL.path)</code>", isError: true)
          }
          return
        }
        Thread.sleep(forTimeInterval: 1)
      }
      DispatchQueue.main.async {
        self.showStatus("השרת לא הגיב בזמן. פרטים ביומן:<br><code>\(self.logURL.path)</code>", isError: true)
      }
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) {
    // עוצרים רק שרת שהאפליקציה עצמה הפעילה. Postgres נשאר לרוץ — אחרים משתמשים בו.
    if let s = server, s.isRunning { s.terminate() }
  }

  // MARK: - שרת

  func isServerUp() -> Bool {
    var request = URLRequest(url: appURL)
    request.timeoutInterval = 2
    let done = DispatchSemaphore(value: 0)
    var ok = false
    URLSession.shared.dataTask(with: request) { _, response, _ in
      ok = (response as? HTTPURLResponse) != nil
      done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + 3)
    return ok
  }

  func startServer() {
    FileManager.default.createFile(atPath: logURL.path, contents: nil)
    guard let log = try? FileHandle(forWritingTo: logURL) else { return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["\(projectDir)/scripts/desktop/start-server.sh", projectDir]
    p.standardOutput = log
    p.standardError = log
    do {
      try p.run()
      server = p
    } catch {
      DispatchQueue.main.async { self.showStatus("לא ניתן להפעיל את השרת: \(error.localizedDescription)", isError: true) }
    }
  }

  func showStatus(_ message: String, isError: Bool = false) {
    let spinner = isError ? "" : "<div class=s></div>"
    let html = """
    <html dir=rtl><head><meta charset=utf-8><style>
    body{margin:0;height:100vh;display:grid;place-items:center;font-family:-apple-system,sans-serif;
         background:#12161e;color:#e8ebf0}
    .b{text-align:center;max-width:520px;line-height:1.7}
    .s{width:34px;height:34px;margin:0 auto 18px;border:3px solid #2b3240;border-top-color:#21ab80;
       border-radius:50%;animation:r 1s linear infinite}
    @keyframes r{to{transform:rotate(360deg)}}
    code{font-size:12px;color:#8592aa;direction:ltr;unicode-bidi:isolate}
    .e{color:#fda4af}
    </style></head><body><div class=b>\(spinner)<div class="\(isError ? "e" : "")">\(message)</div></div></body></html>
    """
    webView.loadHTMLString(html, baseURL: nil)
  }

  // MARK: - ניווט

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // בלי זה המקלדת לא מגיעה לדף: Tab, Enter וקיצורים פשוט נבלעים עד הקליק הראשון.
    webView.window?.makeFirstResponder(webView)
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.allow) }

    if action.shouldPerformDownload { return decisionHandler(.download) }

    // גוגל חוסמת התחברות מתוך תצוגת רשת מוטמעת, ולכן חיבור הדרייב עובר לדפדפן.
    if url.path.hasPrefix("/api/drive/connect") {
      NSWorkspace.shared.open(url)
      return decisionHandler(.cancel)
    }

    // קישורים לאתרים חיצוניים נפתחים בדפדפן הרגיל, לא בתוך החלון.
    let isLocal = url.host == "localhost" || url.host == "127.0.0.1"
    if (url.scheme == "http" || url.scheme == "https") && !isLocal && action.navigationType == .linkActivated {
      NSWorkspace.shared.open(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
               decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    if disposition.lowercased().hasPrefix("attachment") || !response.canShowMIMEType {
      appLog("download requested: \(response.response.url?.absoluteString ?? "?")")
      return decisionHandler(.download)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    appLog("download started (action)")
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    appLog("download started (response)")
    download.delegate = self
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    appLog("provisional navigation failed: \(error.localizedDescription)")
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    appLog("download failed: \(error.localizedDescription)")
  }

  // MARK: - הורדות: נשמרות לתיקיית ההורדות ומוצגות ב-Finder

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    var target = downloads.appendingPathComponent(suggestedFilename)
    let base = target.deletingPathExtension().lastPathComponent
    let ext = target.pathExtension
    var n = 1
    while FileManager.default.fileExists(atPath: target.path) {
      n += 1
      target = downloads.appendingPathComponent(ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)")
    }
    appLog("download destination: \(target.path)")
    pendingDownloads[ObjectIdentifier(download)] = target
    completionHandler(target)
  }

  var pendingDownloads: [ObjectIdentifier: URL] = [:]

  func downloadDidFinish(_ download: WKDownload) {
    let target = pendingDownloads.removeValue(forKey: ObjectIdentifier(download))
    appLog("download finished: \(target?.path ?? "?")")
    if let target { NSWorkspace.shared.activateFileViewerSelecting([target]) }
  }

  // MARK: - חלונות חדשים, דיאלוגים ובחירת קבצים

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    guard let url = action.request.url else { return nil }
    let isLocal = url.host == "localhost" || url.host == "127.0.0.1"
    if !isLocal {
      NSWorkspace.shared.open(url)
      return nil
    }
    // צפייה במסמך סרוק — חלון משני שנסגר בנפרד מהראשי
    let child = WKWebView(frame: .zero, configuration: configuration)
    child.navigationDelegate = self
    child.uiDelegate = self
    let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 1000),
                     styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    w.title = "מסמך"
    w.contentView = child
    w.isReleasedWhenClosed = false
    w.cascadeTopLeft(from: window.frame.origin)
    w.makeKeyAndOrderFront(nil)
    childWindows.append(w)
    return child
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "אישור")
    alert.runModal()
    completionHandler()
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "אישור")
    alert.addButton(withTitle: "ביטול")
    completionHandler(alert.runModal() == .alertFirstButtonReturn)
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.canChooseFiles = true
    panel.beginSheetModal(for: webView.window ?? window) { result in
      completionHandler(result == .OK ? panel.urls : nil)
    }
  }

  // MARK: - תפריט
  // בלי תפריט "עריכה" קיצורי ההעתקה וההדבקה לא עובדים בשדות הטקסט.

  func buildMenu() {
    let main = NSMenu()

    let appItem = NSMenuItem()
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "הסתרה", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "יציאה", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    main.addItem(appItem)

    let editItem = NSMenuItem()
    let edit = NSMenu(title: "עריכה")
    edit.addItem(withTitle: "ביטול פעולה", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "ביצוע מחדש", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "גזירה", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "העתקה", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "הדבקה", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "בחירת הכל", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    main.addItem(editItem)

    let viewItem = NSMenuItem()
    let view = NSMenu(title: "תצוגה")
    view.addItem(withTitle: "רענון", action: #selector(reload), keyEquivalent: "r")
    view.addItem(withTitle: "חזרה", action: #selector(goBack), keyEquivalent: "[")
    view.addItem(withTitle: "קדימה", action: #selector(goForward), keyEquivalent: "]")
    viewItem.submenu = view
    main.addItem(viewItem)

    let windowItem = NSMenuItem()
    let windowMenu = NSMenu(title: "חלון")
    windowMenu.addItem(withTitle: "מזעור", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowMenu.addItem(withTitle: "סגירה", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    windowItem.submenu = windowMenu
    main.addItem(windowItem)
    NSApp.windowsMenu = windowMenu

    NSApp.mainMenu = main
  }

  @objc func reload() { webView.reload() }
  @objc func goBack() { webView.goBack() }
  @objc func goForward() { webView.goForward() }
}

// נתיב הפרויקט נצרב בזמן הבנייה ל-Info.plist
let projectDir = Bundle.main.object(forInfoDictionaryKey: "ProjectDirectory") as? String ?? ""
let app = NSApplication.shared
let delegate = AppDelegate(projectDir: projectDir)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
