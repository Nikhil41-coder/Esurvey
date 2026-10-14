# E-Survey Family Tree

A complete local web application with the original E-Survey landing page design, separate password-protected accounts, a persistent SQLite database, and an interactive family tree.

## Start

Requires Node.js 22.13 or later. No packages need to be installed.

On Windows, double-click **start.cmd**. Or, in this directory, run:

```sh
npm start
```

Open **http://127.0.0.1:49321**. Keep the terminal open while using the app. Create your own account with an email and a password of 10–128 characters. There are no default accounts or passwords. Email is an account identifier; no email is sent and ownership of the address is not verified.

1. Add the head of your family, including name, place name, and door number.
2. Add people by selecting an existing relative and choosing child, parent, sibling, or spouse. For a child, select the second parent to connect them to both parents. A sole recorded spouse is preselected for new children, and the form lets you change or clear that choice before saving. Existing records are not assigned another parent automatically. Select male, female, or neutral relationship labels. Age and occupation are optional.
3. Select any tree card to see their name, relationship to the head, age, occupation, place, door number, notes, and full connection path.
4. Search names, places, relationships, or door numbers; zoom or fit the tree; edit records; export a JSON copy.

The **Explore an example first** button shows clearly marked fictional records without saving them. John Doe demonstrates the requested example: son, age 30, Engineer, Springfield, door 5.

## Password and record protection

The server hashes passwords with a unique random salt and asynchronous scrypt (N=32768, r=8, p=1), compares hashes in constant time, and issues random sessions in HttpOnly, SameSite=Strict cookies. Only session hashes are stored. Sessions last eight hours and survive server restarts; logout revokes them. Mutations require a session-bound CSRF token and reject foreign origins. Authentication has a persistent IP attempt limit. Every record lookup and modification is scoped to the signed-in account.

Family data stays in **data/family.sqlite**. The file contains personal records; restrict access to this folder and include it in your private backups. Password hashes do not encrypt family data at rest. Do not replace or delete this database to upgrade the application. The downloadable source ZIP excludes databases and credentials.

For a forgotten password, the local application administrator can reset it without putting a password in command history:

```sh
node scripts/reset-password.mjs your@email.com
```

The utility prompts for a new password without displaying it and revokes that account’s sessions. It requires access to the local database and does not send recovery emails.

## Architecture and relationship algorithms

- Frontend: HTML, CSS, browser JavaScript, accessible dialogs, and an SVG tree containing real keyboard-focusable member buttons.
- Backend: Node.js HTTP server and SQLite, using built-in modules with no third-party dependencies.
- Model: each family contains one root/head and at most 500 people. Each additional member stores one primary connection (`relativeTo`, `connection`) and can store an explicit `secondParent` on child connections. Primary connections form an adjacency tree, and additional parent links form a pedigree DAG. Validation checks missing links, unique IDs, a single head, generation consistency, and ancestry cycles before every save.
- Reference relationships: BFS from the head calculates paths and generation offsets in O(V+E). Standard ancestor, descendant, sibling, in-law, cousin, aunt/uncle, and niece/nephew paths receive conventional labels. Unrecognized or complex paths retain their explicit relationship chain instead of guessing.
- Layout: post-order traversal calculates subtree centres, then stable generation grouping separates cards. Recorded parents are grouped into family units; both parents connect to a shared junction and their children branch from it. This also joins two parent records entered above an existing child, including the head. Spouses and siblings share a generation row; ancestors are above the head and descendants below. Each card displays its head-relative relationship, and the popup lists its recorded parents. Zoom changes SVG scale without changing records.
- Integrity: writes use an atomic revision check to prevent stale windows overwriting newer records. The server rejects cyclic reconnections and removing members who still connect other people. Reconnect or remove their dependents first.

### Modeling scope

Primary connections form a rooted relationship tree with optional explicit second-parent links. Parenthood is not inferred from marriage alone: choose both parents for a shared child. A child connected only to the head’s spouse is labeled stepchild; selecting the head as second parent correctly labels them son, daughter, or child of the head. A sibling connection denotes a shared family branch. Half-sibling distinctions, multiple marriages, adoption types, and historical relationships are not fully modeled. One record per real person avoids artificial duplicate identities. More complex cases retain readable paths and notes for research context.

Age is entered as a whole number and does not update automatically. Household counts use normalized place and door number. Gender controls kinship terminology only; neutral labels are available.

## Validation

```sh
npm test
```

Tests cover reference relationships and generations, cycle detection, authentication, per-account isolation, invalid passwords, CSRF and origin checks, member validation, edits, stale writes, deletion rules, export, persistent storage, and session revocation.

## Configuration

`PORT` defaults to `49321`; `HOST` defaults to `127.0.0.1`; `DB_PATH` defaults to this project’s `data/family.sqlite`.

This project is delivered for local use. For network hosting, place it behind HTTPS, set `NODE_ENV=production`, set `APP_ORIGIN` to the exact HTTPS origin, and use a durable private database volume. Production cookies require HTTPS. `HOST=0.0.0.0` enables listening on network interfaces. The local Node/SQLite server is not a static site or a Cloudflare Worker; deploy to a Node-capable host. Node 22 currently marks its SQLite module experimental, and the implementation was verified using the installed Node 22.14.0 runtime.

## Files

`public/` contains the interface; `server.mjs` contains HTTP routes and access checks; `lib/store.mjs` creates the SQLite schema; `lib/tree.mjs` contains the relationship algorithms; `test/` contains automated checks; `scripts/reset-password.mjs` performs local password recovery.

API routes: `POST /api/register`, `POST /api/login`, `GET /api/session`, `POST /api/logout`, `GET /api/family`, `POST /api/members`, `PATCH /api/members/:id`, `DELETE /api/members/:id`, and `GET /api/export`. Member writes include the latest family `revision`; authenticated mutations require the `X-CSRF-Token` returned by `/api/session`.
