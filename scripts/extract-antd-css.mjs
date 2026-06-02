// Build-time extraction of AntD's CSS-in-JS critical CSS.
//
// Why this exists:
// AntD's @ant-design/cssinjs injects styles into <head> at runtime (during React
// hydration). In SPA + prerender mode that means the prerendered HTML paints
// before any AntD styles are present, producing a visible "unstyled menu" flash
// on reload (sidebar items rendered as a tight unstyled list with default-sized
// SVG icons). This script renders a representative tree of every AntD component
// the app uses through a shared StyleProvider cache, then calls extractStyle()
// to serialise the cache into a static CSS string. styles.css imports the
// result so Vite bundles it into the same <link rel="stylesheet"> the
// prerendered HTML already references. First paint then ships with AntD's
// layout/typography rules already in place.
//
// Token settings here MUST mirror src/main.tsx's AntThemeBridge so the
// pre-rendered class names match what the runtime cache would produce.
// hashed:false + cssVar key:"vizyon" keep class names stable across runs.

import { renderToString } from "react-dom/server";
import { createElement as h, Fragment } from "react";
import {
  ConfigProvider,
  Layout,
  Menu,
  Button,
  Input,
  Select,
  Table,
  Tag,
  Modal,
  Dropdown,
  Card,
  Popover,
  Tabs,
  DatePicker,
  Form,
  Tooltip,
  Drawer,
  Checkbox,
  Radio,
  Switch,
  Divider,
  Pagination,
  Empty,
  theme as antTheme,
} from "antd";
import { StyleProvider, createCache, extractStyle } from "@ant-design/cssinjs";
import {
  DashboardOutlined,
  InboxOutlined,
  SearchOutlined,
  DownOutlined,
  EllipsisOutlined,
} from "@ant-design/icons";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "..", "src", "antd-critical.css");

const cache = createCache();

const Demo = h(
  Layout,
  { style: { minHeight: 100 } },
  h(
    Layout.Header,
    { style: { background: "transparent", padding: 0 } },
    h(Button, { type: "primary", icon: h(SearchOutlined) }, "Primary"),
    h(Button, null, "Default"),
    h(Button, { type: "text" }, "Text"),
    h(Button, { type: "link" }, "Link"),
    h(Button, { size: "small" }, "Small"),
  ),
  h(
    Layout,
    null,
    h(
      Layout.Sider,
      { width: 280, collapsedWidth: 64 },
      h(Menu, {
        mode: "inline",
        selectedKeys: ["item-1"],
        openKeys: ["group-1"],
        items: [
          { key: "item-1", icon: h(DashboardOutlined), label: "Dashboard" },
          { key: "item-2", icon: h(InboxOutlined), label: "Inbox" },
          {
            key: "group-1",
            icon: h(InboxOutlined),
            label: "Group",
            children: [
              { key: "group-1-child-1", label: "Sub 1" },
              { key: "group-1-child-2", label: "Sub 2" },
            ],
          },
        ],
      }),
    ),
    h(
      Layout.Content,
      { style: { padding: 24 } },
      h(Card, { title: "Card", extra: h(Button, null, "More") }, "Card body content"),
      h(Divider, null),
      h(Tag, null, "Tag"),
      h(Tag, { color: "green" }, "Success"),
      h(Tag, { color: "red" }, "Danger"),
      h(Tag, { color: "blue" }, "Info"),
      h(Tag, { color: "gold" }, "Warning"),
      h(Input, { placeholder: "Input", prefix: h(SearchOutlined) }),
      h(Input.Search, { placeholder: "Search" }),
      h(Select, {
        style: { width: 180 },
        defaultValue: "a",
        options: [
          { label: "Alpha", value: "a" },
          { label: "Beta", value: "b" },
        ],
      }),
      h(DatePicker, null),
      h(Checkbox, null, "Checkbox"),
      h(Radio, null, "Radio"),
      h(Switch, { defaultChecked: true }),
      h(
        Table,
        {
          dataSource: [{ key: 1, n: "Foo" }, { key: 2, n: "Bar" }],
          columns: [
            { title: "Name", dataIndex: "n", sorter: true },
            { title: "Actions", key: "a", render: () => h(EllipsisOutlined) },
          ],
          pagination: { current: 1, pageSize: 10, total: 2 },
        },
      ),
      h(Tabs, {
        items: [
          { key: "1", label: "Tab 1", children: "Tab 1 content" },
          { key: "2", label: "Tab 2", children: "Tab 2 content" },
        ],
      }),
      h(Form, { layout: "vertical" },
        h(Form.Item, { label: "Field", required: true }, h(Input)),
        h(Form.Item, { label: "Select" }, h(Select, { options: [{ label: "X", value: "x" }] })),
      ),
      h(Pagination, { current: 1, total: 50, pageSize: 10 }),
      h(Empty, null),
      h(Tooltip, { title: "Tooltip", open: true }, h(Button, null, "Hover")),
      h(Popover, { content: "Popover content", title: "Popover", open: true }, h(Button, null, "Click")),
      h(Modal, { open: true, title: "Modal", maskClosable: false, footer: null }, "Modal body"),
      h(Drawer, { open: true, title: "Drawer", placement: "right" }, "Drawer body"),
      h(
        Dropdown,
        { open: true, menu: { items: [{ key: "1", label: "Item 1" }, { key: "2", label: "Item 2" }] } },
        h(Button, { icon: h(DownOutlined) }, "Drop"),
      ),
    ),
  ),
);

const tree = h(
  StyleProvider,
  { cache, hashPriority: "high" },
  h(
    ConfigProvider,
    {
      theme: {
        cssVar: { key: "vizyon" },
        hashed: false,
        algorithm: antTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#0F766E",
          borderRadius: 8,
          fontSize: 14,
        },
        components: {
          Layout: { headerBg: "transparent", headerHeight: 56, headerPadding: 0, bodyBg: "transparent" },
          Menu: { itemBg: "transparent", itemHeight: 36, iconSize: 14, subMenuItemBg: "transparent" },
          Button: { controlHeight: 34, controlHeightSM: 28, fontWeight: 600 },
        },
      },
    },
    Demo,
  ),
);

// Touch the tree so cssinjs populates the cache.
renderToString(tree);

const css = extractStyle(cache, true);

mkdirSync(path.dirname(outPath), { recursive: true });

// ── Promote per-component CSS variable scopes to :root ──────────────────────
// AntD's cssVar mode emits rules like
//     .vizyon.ant-menu-css-var { --ant-menu-item-height: 36px; ... }
//     .vizyon.ant-layout       { --ant-layout-sider-bg: #001529; ... }
// The compound selectors only match elements that have BOTH the `vizyon`
// scope class AND the per-component `ant-XYZ-css-var` wrapper class. The
// wrapper class is added at runtime by AntD's ConfigProvider, so before
// React hydrates no element matches and every `var(--ant-...)` resolves to
// nothing — which is exactly the unstyled-menu flash users see on reload.
//
// All AntD variable names are already component-prefixed so they can't
// collide. We sweep every `.vizyon.ant-...{...}` rule, harvest its --ant-*
// declarations, dedupe (later wins), and emit one consolidated
// `:root,.vizyon{...}` block. That makes the variables defined on <html>
// (which carries the `vizyon` class from src/routes/__root.tsx) before any
// JS runs, so first paint already has correct paddings/sizes/colors.
// Runtime AntD still re-injects the same rules with the user's live Theme
// Center primary — those have higher specificity (or come later in the
// cascade) and override the static defaults seamlessly.
const ruleRe = /\.vizyon[^{,]*\{([^}]+)\}/g;
const globals = new Map();
let match;
while ((match = ruleRe.exec(css))) {
  for (const decl of match[1].split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const name = decl.slice(0, colon).trim();
    if (!name.startsWith("--ant-")) continue;
    globals.set(name, decl.slice(colon + 1).trim());
  }
}
const globalsBlock =
  ":root,.vizyon{" +
  Array.from(globals, ([k, v]) => `${k}:${v}`).join(";") +
  "}\n";

const banner = `/* AUTO-GENERATED by scripts/extract-antd-css.mjs — do not edit by hand.
 * Re-run via "npm run build" (or directly: node scripts/extract-antd-css.mjs).
 * This file is the AntD CSS-in-JS output extracted at build time so it can be
 * served as a static stylesheet, eliminating the first-paint flash where
 * AntD-rendered surfaces (sidebar Menu, Buttons, Tags) appear unstyled while
 * the runtime cache is still hydrating.
 */
`;

const finalCss = banner + globalsBlock + css;
writeFileSync(outPath, finalCss, "utf8");

console.log(
  `[extract-antd-css] wrote ${finalCss.length.toLocaleString()} bytes ` +
  `(${globals.size} global vars + ${css.length.toLocaleString()} bytes of rules) ` +
  `to ${path.relative(process.cwd(), outPath)}`,
);
