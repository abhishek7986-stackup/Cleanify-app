import type { Profile } from "@/lib/domain/database";

/** The bottom menu for whoever is in the office: calling staff or an admin. */
export function officeNav(profile: Profile) {
  return profile.role === "admin"
    ? [
        { href: "/admin", label: "Today" },
        { href: "/sales/approvals", label: "Approvals" },
        { href: "/sales/payments", label: "Payments" },
        { href: "/admin/users", label: "Users" },
        { href: "/admin/services", label: "Services" },
      ]
    : [
        { href: "/sales", label: "Today" },
        { href: "/sales/new", label: "New job" },
        { href: "/sales/approvals", label: "Approvals" },
        { href: "/sales/payments", label: "Payments" },
      ];
}
