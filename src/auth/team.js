/**
 * The Buildsuite360 team: the people who run Buildsuite360 itself (adverts, daily social posts). It is not a company role,
 * so no company Administrator can grant it: a person is on the team only if their sign-in email is listed in the server
 * setting BUILDSUITE_TEAM_EMAILS (comma-separated). An empty list means nobody.
 */
export const teamEmails = (env = {}) => String(env.BUILDSUITE_TEAM_EMAILS || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
export const isTeam = (user, config) => !!user?.email && (config?.teamEmails || []).includes(String(user.email).toLowerCase());
