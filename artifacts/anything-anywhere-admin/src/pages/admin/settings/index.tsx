import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Menu } from 'lucide-react';
import { AdminLayout } from '../admin-layout';
import { GeneralSettings } from './general';
import { AdminUsersSettings } from './users';
import { DispatchSettings } from './dispatch';
import { PromotionsSettings } from './promotions';
import { SecuritySettings } from './security';
import { PaymentsSettings } from './payments';
import { EmailSettings } from './email';
import { IntegrationsSettings } from './integrations';
import { SystemStatusSettings } from './system';
import { AuditLogSettings } from './audit';

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', component: GeneralSettings },
  { id: 'users', label: 'Admin Users & Roles', component: AdminUsersSettings },
  { id: 'dispatch', label: 'Dispatch Policy', component: DispatchSettings },
  { id: 'promotions', label: 'Promotions', component: PromotionsSettings },
  { id: 'security', label: 'Security', component: SecuritySettings },
  { id: 'payments', label: 'Payments & Fees', component: PaymentsSettings },
  { id: 'email', label: 'Email', component: EmailSettings },
  { id: 'integrations', label: 'Integrations', component: IntegrationsSettings },
  { id: 'system', label: 'System Status', component: SystemStatusSettings },
  { id: 'audit', label: 'Audit Log', component: AuditLogSettings },
] as const;

export function AdminSettings() {
  const [activeTab, setActiveTab] = useState('general');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (SETTINGS_SECTIONS.some((s) => s.id === hash)) {
        setActiveTab(hash);
      }
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleTabChange = (id: string) => {
    window.location.hash = id;
    setIsMobileMenuOpen(false);
  };

  const ActiveComponent = SETTINGS_SECTIONS.find((s) => s.id === activeTab)?.component || GeneralSettings;

  return (
    <AdminLayout>
      <div className="flex flex-col md:flex-row gap-8">
        <div className="md:hidden mb-4">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="flex w-full items-center justify-between rounded-xl border bg-card px-4 py-3 font-semibold shadow-sm hover:bg-[hsl(var(--muted))]"
          >
            <div className="flex items-center gap-2">
              <SettingsIcon className="size-5" />
              Settings Menu
            </div>
            <Menu className="size-5 text-[hsl(var(--muted-foreground))]" />
          </button>
        </div>

        <aside
          className={`${
            isMobileMenuOpen ? 'block' : 'hidden'
          } md:block w-full md:w-64 shrink-0 space-y-6`}
        >
          <div className="rounded-2xl border bg-[hsl(var(--card))] p-2 shadow-sm">
            <nav className="flex flex-col space-y-1">
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  onClick={() => handleTabChange(section.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    activeTab === section.id
                      ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                      : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]'
                  }`}
                  data-testid={`settings-nav-${section.id}`}
                >
                  {section.label}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        <main className="flex-1 min-w-0 pb-12">
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <ActiveComponent />
          </div>
        </main>
      </div>
    </AdminLayout>
  );
}
