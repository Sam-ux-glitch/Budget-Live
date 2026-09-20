import Capacitor
import WidgetKit
import LinkKit
@objc(BudgetNativePlugin)
public class BudgetNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BudgetNativePlugin"
    public let jsName = "BudgetNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "beginSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openPlaid", returnType: CAPPluginReturnPromise)
    ]
    private var scope = ""
    private var linkSession: PlaidLinkSession?
    @objc func beginSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.scope = call.getString("scope") ?? ""
            do { try WidgetStore.clear(); WidgetCenter.shared.reloadAllTimelines(); call.resolve() }
            catch { call.reject("Widget data could not be cleared") }
        }
    }
    @objc func publish(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.scope.isEmpty, call.getString("scope") == self.scope,
                  let object = call.getObject("snapshot"), let url = WidgetStore.file else { call.reject("Widget session or App Group unavailable"); return }
            do {
                let data = try JSONSerialization.data(withJSONObject: object)
                guard data.count < 8192 else { call.reject("Widget snapshot too large"); return }
                let snapshot = try JSONDecoder().decode(BudgetSnapshot.self, from: data)
                guard snapshot.isCurrent(at: Date()), snapshot.categories.count <= 3,
                    snapshot.categories.allSatisfy({ $0.name.count <= 100 && $0.budget.isFinite && $0.budget >= 0 && $0.spent.isFinite && $0.remaining.isFinite && abs(($0.budget - $0.spent) - $0.remaining) < 0.011 && $0.progress >= 0 && $0.progress <= 1 }) else { call.reject("Invalid widget summary"); return }
                // Encode only the whitelist model; extra JS keys can never reach shared storage.
                try JSONEncoder().encode(snapshot).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                var protectedURL = url; try protectedURL.setResourceValues(values)
                WidgetCenter.shared.reloadAllTimelines(); call.resolve()
            } catch { call.reject("Widget could not update") }
        }
    }
    @objc func openPlaid(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.linkSession == nil, let token = call.getString("token"), let controller = self.bridge?.viewController else { call.reject("Plaid unavailable"); return }
            let config = LinkTokenConfiguration(token: token, onSuccess: { [weak self] success in
                self?.linkSession = nil
                let publicToken: String? = success.publicToken
                guard let token = publicToken else { call.reject("Plaid did not return a public token"); return }
                call.resolve(["publicToken": token])
            }, onExit: { [weak self] _ in self?.linkSession = nil; call.reject("Plaid canceled") }, onEvent: nil, onLoad: nil)
            do { self.linkSession = try Plaid.createPlaidLinkSession(configuration: config); self.linkSession?.open(using: .viewController(controller)) }
            catch { self.linkSession = nil; call.reject("Plaid could not open") }
        }
    }
}
