# WordPress Enhanced

An Obsidian plugin for publishing notes directly to WordPress.

This is an actively maintained fork of [obsidian-wordpress](https://github.com/devbean/obsidian-wordpress) by devbean, which has been unmaintained since December 2023. It fixes several long-standing bugs and adds new features while remaining fully compatible with existing settings and front matter.

---

## Features

- Publish notes to WordPress as posts or pages
- **Gutenberg block output** — wraps rendered HTML in native block comments so each element is editable in the WordPress block editor
- **Inline `#tag` support** — trailing `#hashtags` in a note are automatically stripped from the published content and sent as WordPress tags
- **Reliable image upload** — local images are uploaded to the WordPress media library and rewritten in the published post; images continue to display correctly in Obsidian after publishing
- **Local video upload** — local video files (mp4, webm, mov, etc.) referenced in a note are uploaded to the WordPress media library and published as native `<video>` elements; the original local link is preserved in Obsidian
- Multiple authentication methods: Application Passwords, XML-RPC, miniOrange, WordPress.com OAuth2
- MathJax rendering (SVG or TeX passthrough)
- Obsidian comment (`%%...%%`) handling
- Scheduled posts
- Multiple WordPress profile support

---

## Installation

### Via BRAT (recommended)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. Open BRAT settings and click **Add Beta Plugin**
3. Enter `EoghannIrving/obsidian-wordpress` and click **Add Plugin**
4. Enable **WordPress Enhanced** in **Settings → Community plugins**

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/EoghannIrving/obsidian-wordpress/releases/latest)
2. Copy them to `<your vault>/.obsidian/plugins/obsidian-wordpress-enhanced/`
3. Enable the plugin in **Settings → Community plugins**

---

## Setup

### 1. Add a WordPress profile

Go to **Settings → WordPress Enhanced → Manage profiles** and create a profile:

| Field | Description |
|---|---|
| Name | A label for this site (e.g. "My Blog") |
| WordPress URL | Your site's base URL, e.g. `https://myblog.com` |
| API type | See authentication section below |
| Username | Your WordPress username |
| Password | Your WordPress password or application password |

### 2. Authentication methods

**Application Passwords (recommended)**
Available since WordPress 5.6. Go to **WordPress Admin → Users → Profile → Application Passwords**, generate a password, and use it here. No plugin required.

**XML-RPC**
The traditional method. Must be enabled on your WordPress site (it is by default on most hosts). Some security-hardened setups disable it.

**miniOrange**
Requires the [miniOrange REST API Authentication](https://wordpress.org/plugins/miniorange-login-with-eve-online-google-facebook/) plugin on your WordPress site.

**WordPress.com OAuth2**
For WordPress.com hosted sites only.

---

## Publishing a note

Place your cursor in any note, then either:
- Open the **Command Palette** (`Ctrl/Cmd+P`) and run **Publish to WordPress**
- Click the WordPress icon in the ribbon (enable in settings)

A modal will appear to select post status, type, and category before publishing.

---

## Front matter

The plugin reads and writes YAML front matter. You can set properties before publishing, and the plugin will write `postId` and `categories` back after a successful publish (used for subsequent edits).

```yaml
---
title: Override the note title (optional)
tags:
  - tag-from-frontmatter
  - another-tag
postId: 123          # written by plugin after first publish
postType: post       # post or page
categories:
  - 1                # category IDs, written by plugin
profileName: My Blog # which profile to use
---

Note content here.
```

### Inline `#tags`

Tags can also be placed as `#hashtags` at the end of the note body (after all other content). They are stripped from the published HTML and merged with any front matter tags:

```
...last paragraph of the note.

#javascript #wordpress #obsidian
```

Both front matter tags and inline `#tags` are deduplicated before sending to WordPress. New tags are created automatically if they don't exist.

---

## Settings

| Setting | Description |
|---|---|
| **Profiles** | Manage WordPress site connections |
| **Show ribbon icon** | Display a publish button in the left sidebar |
| **Default post status** | Draft, Published, Private, or Scheduled |
| **Default comment status** | Open or Closed |
| **Remember last categories** | Re-select the last used category on next publish |
| **Show edit confirmation** | Open the WordPress edit page after publishing |
| **MathJax output** | SVG (rendered) or TeX passthrough for `$math$` expressions |
| **Comment conversion** | Strip or convert `%%Obsidian comments%%` to HTML comments |
| **Enable HTML** | Allow raw HTML tags in notes (disabled by default for security) |
| **Replace media links** | After uploading images, rewrite local paths in the note to WordPress URLs using standard markdown syntax so images still display in Obsidian |
| **Gutenberg block output** | Wrap published HTML in Gutenberg block comments for native block editing in WordPress. Disable for Classic Editor sites |

---

## Gutenberg block support

When **Gutenberg block output** is enabled, the rendered HTML is wrapped in WordPress block comments before publishing. This means each element is a proper native block in the WordPress editor rather than a single freeform Classic block.

Supported mappings:

| Markdown | Gutenberg block |
|---|---|
| Paragraph | `wp:paragraph` |
| `# Heading` | `wp:heading` |
| `- List` | `wp:list` |
| `1. List` | `wp:list` (ordered) |
| ` ``` ` code block | `wp:code` |
| `> Blockquote` | `wp:quote` |
| Image | `wp:image` |
| Local video file | `wp:video` |
| `---` / `***` | `wp:separator` |
| Table | `wp:table` |
| Other HTML | `wp:html` (freeform fallback) |

Leave this setting **off** if your WordPress site uses the Classic Editor plugin.

---

## Differences from the original plugin

This fork was created because the original [obsidian-wordpress](https://github.com/devbean/obsidian-wordpress) has not been maintained since December 2023. The following changes have been made:

### New features
- Gutenberg block output with per-element block type mapping
- Trailing `#hashtag` extraction and publishing as WordPress tags
- Inline `#tag` deduplication with front matter tags
- Local video file upload to the WordPress media library, published as native `wp:video` blocks

### Bug fixes
- **Image upload silently skipped** when no editor pane was focused — the upload loop was incorrectly gated on `activeEditor` being non-null
- **Wrong source path for image resolution** — `getFirstLinkpathDest` was passed the image filename instead of the note path, causing relative image links to fail
- **Duplicate image uploads** — the same image referenced multiple times was uploaded once per reference; now cached per publish run
- **Note write-back broke Obsidian image display** — replacing local image links with `![[https://url]]` wikilink syntax, which Obsidian cannot render for remote URLs; now uses `![alt](url)` standard markdown
- **Hashtags stripped from note** — pre-publish content transformations were incorrectly written back to the note; the note write-back now reads from the live editor
- **Separator blocks need recovery in WordPress** — bare `<hr>` was sent instead of `<hr class="wp-block-separator has-alpha-channel-opacity"/>` required by Gutenberg
- **MathJax re-initialised on every expression** — adaptor, handler, and jax instances are now singletons, initialised once on first use
- **HTML attribute injection in image renderer** — `src`, `width`, and `height` are now HTML-escaped before interpolation
- **`lastIndexOf` returning -1 in math block parser** — could cause `slice(pos, -1)` to silently strip the last character of block math content
- **`console.log` of settings during migration** — could expose credentials in the developer console
- **Dead `defaultPostType` property in V2 migration** — set a property that does not exist on the settings interface
- **`saveSettings()` failures were silent** — all settings changes now show a Notice if the save fails
- **Pre-existing TypeScript build errors** — broken `markdown-it` v14 deep-path imports and a type error in the OAuth2 token handler prevented production builds

### Code quality
- Regexes moved to module-level constants (no recompilation per publish/render)
- `getImages()` converted from `regex.exec()` while loops to `matchAll()`
- Dead variable assignments removed from the settings UI

---

## Building from source

```bash
git clone https://github.com/EoghannIrving/obsidian-wordpress
cd obsidian-wordpress
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin folder.

For live development:
```bash
npm run dev
```

---

## Credits

Original plugin by [devbean](https://github.com/devbean/obsidian-wordpress). This fork maintains full credit to the original work and all prior contributors.

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
