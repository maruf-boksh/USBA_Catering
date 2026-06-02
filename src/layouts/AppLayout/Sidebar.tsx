import { memo, useEffect, useMemo, useState } from 'react';
import { Layout, Menu, Button, Tooltip, Popover } from 'antd';
import type { MenuProps } from 'antd';
import { LogoTile } from '@/components/AviationLogo';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PushpinFilled,
  CloseOutlined,
  ColumnHeightOutlined,
  VerticalAlignMiddleOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { MENU_ITEMS, NAV_EXPANDABLE_KEYS, NAV_ROUTE_META_MAP } from './navIndex';
import type { RouteMeta } from './navIndex';
import { NAV_MODULES } from './navConfig';
import type { NavModule, NavSubItem } from './navConfig';
import './Sidebar.css';

const { Sider } = Layout;

export interface AppSidebarProps {
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
  selectedKey: string;
  pinnedItems: RouteMeta[];
  onUnpin: (key: string) => void;
}


function getFirstLeafKey(items: NavSubItem[]): string | undefined {
  for (const it of items) {
    if (it.children) {
      const k = getFirstLeafKey(it.children);
      if (k) return k;
    } else if (it.key.startsWith('/')) {
      return it.key;
    }
  }
  return undefined;
}

interface CascadeColumn {
  title: string;
  items: NavSubItem[];
}

const CASCADE_ROW_PX = 36;
const CASCADE_CHROME_PX = 50;

function getInitialOpenPath(mod: NavModule, selectedKey: string): string[] {
  const path: string[] = [];
  function walk(items: NavSubItem[]): boolean {
    for (const it of items) {
      if (!it.children) {
        if (it.key === selectedKey) return true;
        continue;
      }
      path.push(it.key);
      if (walk(it.children)) return true;
      path.pop();
    }
    return false;
  }
  walk(mod.children);
  return path;
}

interface CascadingFlyoutProps {
  mod: NavModule;
  selectedKey: string;
  onNavigate: (path: string) => void;
}

const CascadingFlyout = memo(function CascadingFlyout({
  mod,
  selectedKey,
  onNavigate,
}: CascadingFlyoutProps) {
  const [openPath, setOpenPath] = useState<string[]>(() =>
    getInitialOpenPath(mod, selectedKey),
  );

  const columns = useMemo<CascadeColumn[]>(() => {
    const cols: CascadeColumn[] = [{ title: mod.label, items: mod.children }];
    let current = mod.children;
    for (const k of openPath) {
      const parent = current.find((c) => c.key === k && c.children);
      if (!parent || !parent.children) break;
      cols.push({ title: parent.label, items: parent.children });
      current = parent.children;
    }
    return cols;
  }, [mod, openPath]);

  // Lock cascade height to column 1's natural size. Deeper columns inherit
  // this height via flex `align-items: stretch` and scroll if taller, so
  // expanding sub-columns never grows the popover or shifts its position.
  const cascadeHeight =
    mod.children.length * CASCADE_ROW_PX + CASCADE_CHROME_PX;

  return (
    <div
      className="sb-rail-cascade"
      style={{ ['--sb-cascade-h' as string]: `${cascadeHeight}px` }}
    >
      {columns.map((col, colIdx) => (
        <div className="sb-rail-flyout" key={`${colIdx}-${col.title}`}>
          <div className="sb-rail-flyout-title">{col.title}</div>
          <ul className="sb-rail-col-list">
            {col.items.map((item) => {
              const hasChildren = !!item.children;
              const isOpen = hasChildren && openPath[colIdx] === item.key;
              const isSelected = item.key === selectedKey;
              return (
                <li
                  key={item.key}
                  className={
                    'sb-rail-col-item' +
                    (isOpen ? ' is-open' : '') +
                    (isSelected ? ' is-selected' : '')
                  }
                  onMouseEnter={() => {
                    setOpenPath((prev) => {
                      const next = prev.slice(0, colIdx);
                      if (hasChildren) next.push(item.key);
                      return next;
                    });
                  }}
                  onClick={() => {
                    if (!hasChildren && item.key.startsWith('/')) {
                      onNavigate(item.key);
                    }
                  }}
                >
                  {item.icon && <span className="sb-rail-col-icon">{item.icon}</span>}
                  <span className="sb-rail-col-label">{item.label}</span>
                  {hasChildren && (
                    <RightOutlined className="sb-rail-col-arrow" />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
});

interface CollapsedRailProps {
  selectedKey: string;
  onNavigate: (path: string) => void;
}

const CollapsedRail = memo(function CollapsedRail({ selectedKey, onNavigate }: CollapsedRailProps) {
  const activeModuleKey = NAV_ROUTE_META_MAP.get(selectedKey)?.openKeys[0];

  return (
    <ul className="sb-rail">
      {NAV_MODULES.map((mod) => {
        const isActive = mod.key === activeModuleKey;
        const firstLeaf = getFirstLeafKey(mod.children);

        const button = (
          <button
            type="button"
            className={`sb-rail-item${isActive ? ' is-active' : ''}`}
            onClick={() => firstLeaf && onNavigate(firstLeaf)}
            aria-label={mod.label}
          >
            <span className="sb-rail-icon">{mod.icon}</span>
          </button>
        );

        return (
          <li key={mod.key}>
            <Popover
              destroyTooltipOnHide
              content={
                <CascadingFlyout
                  mod={mod}
                  selectedKey={selectedKey}
                  onNavigate={onNavigate}
                />
              }
              placement="rightTop"
              trigger="hover"
              arrow={false}
              mouseEnterDelay={0.05}
              mouseLeaveDelay={0.18}
              overlayClassName="sb-rail-popover"
              autoAdjustOverflow
              align={{
                offset: [4, -4],
                overflow: { adjustX: true, adjustY: true, shiftY: true },
              }}
            >
              {button}
            </Popover>
          </li>
        );
      })}
    </ul>
  );
});

export const AppSidebar = memo(function AppSidebar({
  collapsed,
  onCollapsedChange,
  selectedKey,
  pinnedItems,
  onUnpin,
}: AppSidebarProps) {
  const navigate = useNavigate();

  const routeOpenKeys = useMemo(
    () => NAV_ROUTE_META_MAP.get(selectedKey)?.openKeys ?? [],
    [selectedKey],
  );

  const [openKeys, setOpenKeys] = useState<string[]>(routeOpenKeys);

  useEffect(() => {
    if (collapsed) return;
    setOpenKeys((prev) => Array.from(new Set([...prev, ...routeOpenKeys])));
  }, [collapsed, routeOpenKeys]);

  const allExpanded =
    NAV_EXPANDABLE_KEYS.length > 0 &&
    NAV_EXPANDABLE_KEYS.every((k) => openKeys.includes(k));

  const toggleExpandAll = () =>
    setOpenKeys(allExpanded ? [] : [...NAV_EXPANDABLE_KEYS]);

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (typeof key === 'string' && key.startsWith('/')) navigate(key);
  };

  return (
    <Sider
      className="sb-sider"
      collapsed={collapsed}
      onCollapse={onCollapsedChange}
      collapsible
      trigger={null}
      width={272}
      collapsedWidth={72}
      theme="light"
    >
      <div className="sb-root">
        <button
          type="button"
          className={`sb-brand${collapsed ? ' is-collapsed' : ''}`}
          onClick={() => navigate('/')}
          aria-label="Go to home"
        >
          <span className="sb-brand-mark">
            <LogoTile size={36} glow={false} />
          </span>
          {!collapsed && (
            <span className="sb-brand-copy">
              <span className="sb-brand-name">
                <span className="sb-brand-word">Harvest</span>
                <em>Catering</em>
                <i className="sb-brand-underline" aria-hidden />
              </span>
              <span className="sb-brand-tagline">Airlines Catering Management</span>
            </span>
          )}
        </button>

        {!collapsed && pinnedItems.length > 0 && (
          <div className="sb-pinned">
            <div className="sb-section-label">
              <span>
                <PushpinFilled /> Pinned
              </span>
            </div>
            <ul className="sb-pinned-list">
              {pinnedItems.map((item) => (
                <li
                  key={item.key}
                  className={`sb-pinned-item${selectedKey === item.key ? ' is-active' : ''}`}
                  onClick={() => navigate(item.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(item.key);
                    }
                  }}
                >
                  <span>{item.label}</span>
                  <button
                    type="button"
                    className="sb-pinned-remove"
                    aria-label={`Unpin ${item.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnpin(item.key);
                    }}
                  >
                    <CloseOutlined />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!collapsed && (
          <div className="sb-section-label">
            <span>Menu</span>
            <button
              type="button"
              className={`sb-expand-all${allExpanded ? ' is-active' : ''}`}
              onClick={toggleExpandAll}
              aria-pressed={allExpanded}
            >
              {allExpanded ? <VerticalAlignMiddleOutlined /> : <ColumnHeightOutlined />}
              <span>{allExpanded ? 'Collapse' : 'Expand'} all</span>
            </button>
          </div>
        )}

        {collapsed ? (
          <div className="sb-rail-wrap">
            <CollapsedRail selectedKey={selectedKey} onNavigate={navigate} />
          </div>
        ) : (
          <div className="sb-menu-wrap">
            <Menu
              className="sb-menu"
              mode="inline"
              theme="light"
              inlineIndent={16}
              selectedKeys={[selectedKey]}
              openKeys={openKeys}
              onOpenChange={(keys) => setOpenKeys(keys as string[])}
              items={MENU_ITEMS}
              onClick={handleMenuClick}
            />
          </div>
        )}

        <div className={`sb-foot${collapsed ? ' is-collapsed' : ''}`}>
          {!collapsed && (
            <span className="sb-foot-copy">
              Harvest Catering · 2026
              <span className="sb-foot-sub">powered by US-Bangla Airlines</span>
            </span>
          )}
          <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
            <Button
              type="text"
              className="sb-foot-toggle"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => onCollapsedChange(!collapsed)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            />
          </Tooltip>
        </div>
      </div>
    </Sider>
  );
});
