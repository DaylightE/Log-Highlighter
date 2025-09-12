F-List Log Highlighter (Firefox)
================================

Highlights F-List report logs by re-rendering the page with clearer metadata and color-coding.

Match URL: https://www.f-list.net/fchat/getLog.php?log=<id>

Features
- Highlight senders:
  - Reporting user messages: red background
  - Log submitted by messages: blue background
  - Additional names: green background (comma-separated input)
- Select and copy:
  - Click any message to toggle a gold selection border
  - Use the "Copy Selected" button (beside the Up/Down buttons) to copy selected messages to your clipboard in chronological order
- Header details:
  - Shows 'Log submitted by', 'Log submitted on', 'Reporting user' and 'Tab'
  - Colors the submitter and reporter names by profile gender:
    - None: Grey, Female: Pink, Male: default link blue, Herm: Dark purple, Male-Herm: Dark blue, Shemale: Light purple, Cunt-Boy: Green, Transgender: Orange
    - Uses 'Gender:' from the user's profile page
  - Adds a star in front of the tab name when it's an official channel (based on known slugs)
  - Collapse/expand header controls
- Legend toggles:
  - Click the colored boxes to enable/disable highlighting for Reported, Submitted, and Additional names (saved in your browser)
- Navigation:
  - Up/Down buttons next to 'Additional names' jump between highlighted messages (Reporting user, Log submitter, and Additional names)
  - Keeps your place even after editing the Additional names list
- Time tools:
  - Convert all [HH:MM] and [YYYY-MM-DD HH:MM] (with optional AM/PM) to local time
  - Remembers preference per browser via localStorage
- Extras:
  - Computes and displays the maximum [icon]/[eicon] count for the reported user
  - One-time disable via 'fhl_off=1' URL param or the close button

Install (temporary, for development)
1) Open Firefox and go to: about:debugging#/runtime/this-firefox
2) Click "Load Temporary Add-on"
3) Select this folder's manifest.json
4) Visit a log page (e.g. https://www.f-list.net/fchat/getLog.php?log=173488)

Notes
- This extension only reads and re-renders the log page content client-side.
- No data is sent anywhere; it does not require special permissions.


Chrome Version
==============
A Chrome-ready copy is in `../fchat-highlighter-chrome/`.

- Load in Chrome (dev): go to `chrome://extensions`, enable Developer Mode, click "Load unpacked", select `fchat-highlighter-chrome/`.
- Package for the Chrome Web Store: zip the contents of `fchat-highlighter-chrome/` (not the parent folder) and upload.
- The Chrome manifest omits Firefox-only `browser_specific_settings` and reuses the same `content.js` and `icon-128.png`.

- Chrome build includes click-to-select and the "Copy Selected" button, matching Firefox.


What's New
----------
2.0
- Click a message to toggle selection (gold border)
- Add "Copy Selected" button beside the Up/Down arrows to copy selected messages (chronological order) to clipboard

1.5
- Clickable legend toggles to enable/disable Reported/Submitted/Additional highlights (saved per browser)
- Add Up/Down navigation beside "Additional names" to move through highlighted messages
- Preserve navigation position when Additional names changes (no jumping back to start)
- Add subtle outline to the currently navigated message for clarity

1.4
- Gender-based name colors in header; names default to grey until loaded; Male stays default link blue
- Show 'Tab' under Reporting user, with star when its parentheses slug matches the provided list (e.g., ageplay)
- AM/PM timestamp support and inline timestamp handling in Report text
- ASCII-only header controls to avoid encoding issues

1.3
- Initial public version with highlighting, extras input, and time conversion
