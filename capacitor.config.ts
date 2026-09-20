import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.budgetlive.personal', appName: 'Budget Live', webDir: 'out',
  ios: { contentInset: 'never', backgroundColor: '#09090b', preferredContentMode: 'mobile' },
  plugins: { Keyboard: { resize: 'body' } },
};
export default config;
