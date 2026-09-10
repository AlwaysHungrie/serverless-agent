import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * The pages that render for a signed-out visitor.
 *
 * Only the front door and Clerk's own screens. Everything else — every agent page,
 * every API route the browser calls — needs a session, because everything else is
 * either someone's agent or a call made on their behalf. The one API route that is
 * signed-in-but-not-agent-scoped is `POST /api/agents`: creating an agent needs an
 * account, but there is no access list to check against yet.
 */
const isPublic = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"]);

/**
 * `proxy` is the Next 16 name for what used to be `middleware`; both the named and
 * the default export are kept so Clerk finds its handler either way.
 */
export const proxy = clerkMiddleware(async (auth, request) => {
  if (isPublic(request)) return;
  await auth.protect();
});

export default proxy;

export const config = {
  matcher: [
    // Everything except Next's own build output and static files, which no
    // session check has anything to say about.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
