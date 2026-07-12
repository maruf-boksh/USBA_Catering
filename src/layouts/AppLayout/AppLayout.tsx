import { memo, useState, useMemo, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Layout, Button, Avatar, Badge, Tooltip, Breadcrumb, Dropdown, Divider } from 'antd';
import { ThemeCenter } from '@/components/ThemeCenter';
import type { MenuProps } from 'antd';
import { useRole } from '@/lib/roles';
import { useAllRoles, useAccess, canViewPage } from '@/lib/access-control';
import { Lock } from 'lucide-react';
import { MobileApp } from '@/mobile/MobileApp';
import {
  MenuFoldOutlined, MobileOutlined,
  MenuUnfoldOutlined,
  BellOutlined,
  BgColorsOutlined,
  UserOutlined,
  QuestionCircleOutlined,
  StarFilled,
  StarOutlined,
  SettingOutlined,
  LogoutOutlined,
  DownOutlined,
  ClockCircleOutlined,
  IdcardOutlined,
  CheckOutlined,
  PushpinFilled,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { GlobalSearch } from './GlobalSearch';
import {
  MENU_ITEMS,
  NAV_ROUTE_META_MAP,
  NAV_VALID_ROUTE_KEYS,
  resolveSelectedNavKey,
} from './navIndex';
import type { BreadcrumbItem, RouteMeta } from './navIndex';
import { TabBar } from './TabBar';
import { AppSidebar } from './Sidebar';

const { Header, Content } = Layout;
const PINNED_STORAGE_KEY = 'harvest-catering.pinned-pages';
const PINNED_LIMIT = 6;

// Tracks whether the viewport is in the mobile/tablet range where the sidebar
// becomes an off-canvas drawer instead of a docked column.
function useIsMobile(query = '(max-width: 1023px)'): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function parseStoredKeys(raw: string | null, validKeys: Set<string>, limit: number): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const unique = new Set<string>();
    for (const value of parsed) {
      if (typeof value !== 'string') continue;
      if (!validKeys.has(value) || unique.has(value)) continue;
      unique.add(value);
      if (unique.size >= limit) break;
    }
    return Array.from(unique);
  } catch {
    return [];
  }
}


function normalizeLabel(label: string): string {
  return label
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function useBreadcrumb(pathname: string): BreadcrumbItem[] | null {
  return useMemo(() => {
    const selectedKey = resolveSelectedNavKey(pathname);
    return NAV_ROUTE_META_MAP.get(selectedKey)?.breadcrumb ?? null;
  }, [pathname]);
}

// ─── Notification data (static mock) ──────────────────────────────────────────
const PINNED_NOTIFICATION = { id: 0, title: 'New Pending Approvals', desc: 'Pending items require your review and approval.', time: 'Pinned', unread: true, route: '/approval-management', pinned: true };
const NOTIFICATION_ITEMS: { id: number; title: string; desc: string; time: string; unread: boolean; route: string; pinned: boolean }[] = [];

const CLOCK_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

const CLOCK_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const TopbarClock = memo(function TopbarClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const clockTimer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(clockTimer);
  }, []);

  return (
    <div className="app-time-chip">
      <ClockCircleOutlined style={{ fontSize: 11 }} />
      <span className="app-time-divider" />
      <span>{CLOCK_TIME_FORMATTER.format(now)}</span>
      <span className="app-time-date">{CLOCK_DATE_FORMATTER.format(now)}</span>
    </div>
  );
});

function NotificationPanel({ onNavigate }: { onNavigate: (route: string) => void }) {
  const allItems = [PINNED_NOTIFICATION, ...NOTIFICATION_ITEMS];
  return (
    <div className="app-notif-panel">
      <div className="app-notif-header">
        <span className="app-notif-header-title">Notifications</span>
        <Button type="text" size="small" className="app-notif-mark-read">Mark all read</Button>
      </div>
      <div className="app-notif-list">
        {allItems.map(n => (
          <div
            key={n.id}
            className={`app-notif-item${n.unread ? '' : ' is-read'}${n.pinned ? ' app-notif-item-pinned' : ''}`}
            onClick={() => onNavigate(n.route)}
          >
            {n.pinned
              ? <PushpinFilled style={{ fontSize: 11, color: 'var(--color-primary)', marginTop: 4, flexShrink: 0 }} />
              : <span className="app-notif-indicator" />
            }
            <div className="app-notif-body">
              <div className="app-notif-title">{n.title}</div>
              <div className="app-notif-desc">{n.desc}</div>
              <div className="app-notif-time">{n.time}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="app-notif-footer">
        <Button type="text" size="small" block className="app-notif-view-all">View all notifications</Button>
      </div>
    </div>
  );
}

interface AppLayoutProps {
  children: ReactNode;
  currentUser?: {
    userId: string;
    displayName?: string;
  };
  onSignOut?: () => void;
}

export function AppLayout({ children, currentUser, onSignOut }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileAppOpen, setMobileAppOpen] = useState(false);
  const isMobile = useIsMobile();
  // On mobile the sidebar is an off-canvas drawer toggled by the hamburger;
  // on desktop the hamburger toggles the docked-column collapse.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { role, setRole } = useRole();
  const allRoles = useAllRoles();
  const access = useAccess();

  const selectedKey = useMemo(() => resolveSelectedNavKey(location.pathname), [location.pathname]);

  const breadcrumb = useBreadcrumb(location.pathname);

  // Close the mobile drawer whenever the route changes (e.g. after tapping a nav item).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Hamburger: toggles the drawer on mobile, the docked collapse on desktop.
  const handleNavToggle = () => {
    if (isMobile) setMobileNavOpen((o) => !o);
    else setCollapsed((c) => !c);
  };

  const [pinnedKeys, setPinnedKeys] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    return parseStoredKeys(window.localStorage.getItem(PINNED_STORAGE_KEY), NAV_VALID_ROUTE_KEYS, PINNED_LIMIT);
  });

  const isCurrentPagePinned = pinnedKeys.includes(selectedKey);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinnedKeys));
  }, [pinnedKeys]);

  const handleProfileMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'logout') {
      onSignOut?.();
      return;
    }
    if (key === 'view-profile') {
      navigate('/profile');
      return;
    }
    if (key === 'settings') {
      navigate('/account-settings');
      return;
    }
    if (key.startsWith('role:')) {
      setRole(key.slice('role:'.length));
    }
  };

  // Profile dropdown — the acting-role switcher now lives here (under the avatar),
  // instead of as a standalone control in the top bar.
  const profileMenuItems: MenuProps['items'] = [
    { key: 'view-profile', label: 'View Profile', icon: <IdcardOutlined /> },
    { key: 'settings', label: 'Account Settings', icon: <SettingOutlined /> },
    { type: 'divider' },
    {
      key: 'acting-role',
      icon: <IdcardOutlined />,
      label: `Acting role · ${role}`,
      children: allRoles.map((r) => ({
        key: `role:${r}`,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: 168 }}>
            <span>{r}</span>
            {r === role && <CheckOutlined style={{ fontSize: 12, color: 'var(--color-primary)' }} />}
          </span>
        ),
      })),
    },
    { type: 'divider' },
    { key: 'logout', label: 'Sign Out', icon: <LogoutOutlined />, danger: true },
  ];

  const togglePinCurrentPage = () => {
    if (!NAV_VALID_ROUTE_KEYS.has(selectedKey)) return;
    setPinnedKeys(prev => {
      if (prev.includes(selectedKey)) {
        return prev.filter(key => key !== selectedKey);
      }
      return [selectedKey, ...prev].slice(0, PINNED_LIMIT);
    });
  };

  const pinnedMeta = useMemo(
    () => pinnedKeys
      .map(key => NAV_ROUTE_META_MAP.get(key))
      .filter((item): item is RouteMeta => Boolean(item)),
    [pinnedKeys],
  );

  const handleUnpin = (key: string) => {
    setPinnedKeys(prev => prev.filter(k => k !== key));
  };

  return (
    <Layout
      className="app-layout-shell"
      data-mobile-nav={isMobile && mobileNavOpen ? 'open' : 'closed'}
      style={{ height: '100vh', overflow: 'hidden' }}
    >
      <AppSidebar
        collapsed={isMobile ? false : collapsed}
        onCollapsedChange={setCollapsed}
        selectedKey={selectedKey}
        pinnedItems={pinnedMeta}
        onUnpin={handleUnpin}
      />
      {isMobile && mobileNavOpen && (
        <div className="app-nav-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden />
      )}

      <Layout className="app-main-shell" style={{ overflow: 'hidden', minWidth: 0 }}>
        <Header className="app-topbar-shell" style={{ height: 64, lineHeight: '64px', padding: '10px 16px', flexShrink: 0, zIndex: 10 }}>
          <div className="app-topbar-inner">
            <div className="app-topbar-left">
              <Button
                type="text"
                size="small"
                className="app-topbar-toggle"
                icon={(isMobile ? !mobileNavOpen : collapsed) ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={handleNavToggle}
              />
              {breadcrumb && breadcrumb.length > 0 && (
                <Breadcrumb
                  items={breadcrumb.map((item, idx) => ({
                    title: (
                      <span
                        className={idx === breadcrumb.length - 1 ? 'app-crumb-active' : 'app-crumb'}
                        onClick={() => navigate(item.path)}
                      >
                        {normalizeLabel(item.label)}
                      </span>
                    ),
                  }))}
                  separator="/"
                />
              )}
              <Button
                type="text"
                size="small"
                className="app-pin-toggle"
                icon={isCurrentPagePinned ? <StarFilled /> : <StarOutlined />}
                onClick={togglePinCurrentPage}
              >
                {isCurrentPagePinned ? 'Pinned' : 'Pin'}
              </Button>

              <button
                onClick={() => setMobileAppOpen(true)}
                className="app-topbar-mobileview"
                title="AeroGalley Catering App"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 14px',
                  height: 28,
                  background: 'rgba(255,255,255,0.18)',
                  border: '1px solid rgba(255,255,255,0.55)',
                  borderRadius: 6,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                  backdropFilter: 'blur(4px)',
                  letterSpacing: '0.01em',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                <MobileOutlined style={{ fontSize: 14 }} />
                <span className="app-topbar-mobileview-label">AeroGalley Catering App</span>
              </button>
            </div>

            <div className="app-topbar-right">
              <TopbarClock />

              <GlobalSearch />

              <Dropdown
                dropdownRender={() => <ThemeCenter />}
                trigger={['click']}
                placement="bottomRight"
                overlayClassName="theme-dropdown-overlay"
              >
                <Tooltip title="Theme Center">
                  <Button
                    type="text"
                    size="small"
                    className="app-topbar-icon-button app-topbar-optional"
                    icon={<BgColorsOutlined style={{ fontSize: 17 }} />}
                  />
                </Tooltip>
              </Dropdown>

              <Tooltip title="Help & resources">
                <Button
                  type="text"
                  size="small"
                  className="app-topbar-icon-button app-topbar-optional"
                  icon={<QuestionCircleOutlined style={{ fontSize: 17 }} />}
                />
              </Tooltip>

              {/* Notifications dropdown */}
              <Dropdown
                open={notifOpen}
                onOpenChange={setNotifOpen}
                dropdownRender={() => (
                  <NotificationPanel
                    onNavigate={(route) => {
                      setNotifOpen(false);
                      navigate(route);
                    }}
                  />
                )}
                trigger={['click']}
                placement="bottomRight"
                overlayClassName="app-notif-dropdown-overlay"
              >
                <Badge count={1} size="small" offset={[-2, 2]}>
                  <Button
                    type="text"
                    size="small"
                    className="app-topbar-icon-button"
                    icon={<BellOutlined style={{ fontSize: 17 }} />}
                  />
                </Badge>
              </Dropdown>

              <Divider type="vertical" className="app-topbar-divider" />

              {/* Profile dropdown */}
              <Dropdown
                menu={{ items: profileMenuItems, onClick: handleProfileMenuClick }}
                trigger={['click']}
                placement="bottomRight"
                overlayClassName="app-profile-dropdown"
              >
                <div className="header-profile" role="button" tabIndex={0}>
                  <Avatar
                    size={34}
                    icon={<UserOutlined />}
                    style={{
                      background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
                      flexShrink: 0,
                    }}
                  />
                  <div className="header-profile-copy">
                    <div className="header-profile-name">{currentUser?.displayName ?? currentUser?.userId ?? 'Admin User'}</div>
                    <div style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.1, color: 'var(--color-muted-foreground)' }}>{role}</div>
                  </div>
                  <DownOutlined className="header-profile-chevron" />
                </div>
              </Dropdown>
            </div>
          </div>
        </Header>

        <Content className="app-content-shell" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
          {NAV_VALID_ROUTE_KEYS.has(selectedKey) && !canViewPage(role, selectedKey, access) ? (
            <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', padding: 24 }}>
              <div style={{ textAlign: 'center', maxWidth: 420 }}>
                <Lock style={{ width: 32, height: 32, color: 'var(--color-muted-foreground)', margin: '0 auto 12px' }} />
                <div style={{ fontWeight: 600, color: 'var(--color-foreground)' }}>Access restricted</div>
                <p style={{ fontSize: 13, color: 'var(--color-muted-foreground)', marginTop: 6 }}>
                  Your role (<strong>{role}</strong>) doesn’t have view access to this page. Ask a GM/Admin to grant it in
                  Configuration → User Access Control.
                </p>
              </div>
            </div>
          ) : (
            children
          )}
        </Content>
        <TabBar menuItems={MENU_ITEMS} />
      </Layout>

      {mobileAppOpen && <MobileApp onClose={() => setMobileAppOpen(false)} />}
    </Layout>
  );
}
