import Capacitor
class BudgetViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(BudgetNativePlugin()) }
}
