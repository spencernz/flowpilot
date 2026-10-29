import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Inbox,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { client } from "../../api/client";
const links = [
  { path: "/", title: "Overview", icon: LayoutDashboard },
  { path: "/inbox", title: "Request inbox", icon: Inbox },
  { path: "/activity", title: "Activity log", icon: Activity },
  { path: "/settings", title: "Settings", icon: Settings },
];
export function Layout() {
  const location = useLocation();
  const config = useQuery({ queryKey: ["config"], queryFn: client.config });
  const stats = useQuery({ queryKey: ["stats"], queryFn: client.stats });
  return (
    <div className="app">
      <aside>
        <NavLink to="/" className="brand">
          <span className="logo">
            <Workflow size={23} />
          </span>
          <span>FlowPilot</span>
        </NavLink>
        <div className="side-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {links.map(({ path, title, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              className={({ isActive }) => `nav ${isActive ? "active" : ""}`}
              title={title}
            >
              <Icon size={19} />
              <span>{title}</span>
              {path === "/inbox" && !!stats.data?.needs_review && (
                <b className="count">{stats.data.needs_review}</b>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-callout">
          <ShieldCheck size={19} />
          <strong>AI assisted. Human approved.</strong>
          <p>You stay in control of every customer interaction.</p>
          <NavLink to="/settings">
            Workspace configuration <ArrowUpRight size={13} />
          </NavLink>
        </div>
        <div className="sidebar-bottom">
          <div className="avatar">FP</div>
          <div>
            <strong>Demo Workspace</strong>
            <small>Local administrator</small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>
              {links.find((x) => x.path === location.pathname)?.title ||
                "Workspace"}
            </strong>
          </div>
          <div className="header-right">
            <span className={`live ${config.isError ? "offline" : ""}`}>
              <span className="dot" />
              {config.isError
                ? "Backend unavailable"
                : config.data
                  ? `${config.data.ai_provider === "mock" ? "Mock" : "OpenAI"} environment`
                  : "Connecting…"}
            </span>
            <div className="avatar">FP</div>
          </div>
        </header>
        <div className="content">
          <Outlet />
          <footer>
            FlowPilot · A proof of concept combining AI with a human-in-the-loop
            workflow
          </footer>
        </div>
      </main>
    </div>
  );
}
