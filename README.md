F-List Log Highlighter
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
  - Click the clipboard icon (beside the Up/Down buttons) to copy selected messages to your clipboard in chronological order
  - Eye toggle to show only highlighted or selected messages; hidden runs are collapsed with an "N messages hidden" placeholder
- Ads filter:
  - Toggle to hide messages unless the first non-space character after the timestamp is `*` (emote) or a name ends with `: ` within the first 22 characters
  - Does not hide highlighted or selected messages
  - Plays nicely with the eye toggle using nested "N ads hidden" placeholders inside opened groups; each ads segment can be opened/closed independently
- Header details:
  - Shows 'Log submitted by', 'Log submitted on', 'Reporting user' and 'Tab'
  - Colors the submitter and reporter names by profile gender:
    - None: Grey, Female: Pink, Male: default link blue, Herm: Dark purple, Male-Herm: Dark blue, Shemale: Light purple, Cunt-Boy: Green, Transgender: Orange
    - Uses 'Gender:' from the user's profile page
  - Adds a star in front of the tab name when it's an official channel (based on known slugs)
  - Collapse/expand header controls
  - Centered Previous/Next report buttons (styled like header buttons) jump to `?log=<id-1>` and `?log=<id+1>`
  - Disclaimers under the version label to remind that highlighting/hiding isn't perfect and timestamp-based detection can be confused by shared logs
- Legend toggles:
  - Click the colored boxes to enable/disable highlighting for Reported, Submitted, and Additional names (saved in your browser)
- Navigation:
  - Up/Down buttons next to 'Additional names' jump between highlighted messages (Reporting user, Log submitter, and Additional names)
  - Keeps your place even after editing the Additional names list
- Time tools:
  - Automatically formats the "Log submitted on" timestamp in your local timezone
- Extras:
  - Compact mode toggle to shrink spacing between messages
  - Text size controls (-/[Text size]/+) to adjust message font scale
  - Computes and displays the maximum [icon]/[eicon] count for the reported user
  - One-time disable via 'fhl_off=1' URL param or the close button

Notes
- This extension only reads and re-renders the log page content client-side.
- No data is sent anywhere; it does not require special permissions.


Firefox Version
==============
A Firefox-ready copy is in `binaries/`.

- Download the latest log_highlighter.xpi file and run it
- You should get a popup in Firefox to add the extension


Chrome Version
==============

- Click [here](https://chromewebstore.google.com/detail/cnmbdgoiiklkdbinjlcijbggpaaibhjb?utm_source=item-share-cb) to install the extension on the Google Web Store

Alternatively, a Chrome-ready copy is in `binaries/`.

- Download fchat-highlighter-chrome.zip, and extract it
- Go to `chrome://extensions`, enable Developer Mode, click "Load unpacked", select the folder you just extracted.


What's New
----------
2.6
- Copying selected messages now inserts a zero-width space into the timestamp so pasting back into chat keeps them in a single block instead of being treated as separate messages.

2.5
- Add compact mode checkbox to shrink message spacing and remember the preference.
- Provide persistent text size controls (- / Text size / +) that resize only the log content.
- Scale message padding and placeholder gaps with text size so tighter fonts stay readable.

2.4.4
- Automatically localize the "Log submitted on" header timestamp; remove the manual convert button and inline log rewrites due to them not working right. 

2.4
- Ads filter toggle with refined logic:
  - Pass if the first non-space character after the timestamp is `*` (emote), or a name ends with `: ` within the first 22 characters.
  - Does not hide highlighted or selected messages.
  - Plays nicely with the eye toggle: nested "x ads hidden" placeholders appear inside opened groups; each ads segment can be opened/closed independently.
- Header enhancements:
  - Centered prev/next report buttons styled like header controls.
  - Added disclaimers under the version label.

2.3
- Improve hidden-group expansion logic: expanding a hidden run and then selecting a message in the middle no longer causes sibling portions to re-hide when you toggle one placeholder. Each placeholder now controls only its own segment reliably.
- Keep expanded segments visible when selecting/deselecting messages within them.

2.2
- Add eye toggle: hide all non-highlighted/non-selected messages and replace gaps with a "N messages hidden" placeholder. Eye turns red when active.
- Replace text label with traditional copy icon (two overlapping sheets) for the copy-to-clipboard button.

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
- Initial version with highlighting, extras input, and time conversion
