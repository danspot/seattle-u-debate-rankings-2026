# Maintaining this project

When asked to update the debate rankings, complete the refresh and public deployment workflow in README.md. Use Playwright/Chromium on the Plustab website as the only tournament data source; explicitly select Rounds 1 and 2. Do not use live data requests in the published page. The user has requested publication of individual speaker feedback: collect it, verify its speaker/side/position, and show it by round in each speaker's feedback dialog. Do not treat a general decision explanation as individual speaker feedback.

Preserve the NoviceS MS 3-on-3 default, equal treatment of all participants, source evidence, missing-score indicators, and tie rules. The named verification participant belongs only in checks/reports, never a featured page element.

Use the existing repository https://github.com/danspot/seattle-u-debate-rankings-2026 and GitHub Pages deployment. Run verification, tests, build, and browser QA; commit the snapshot and generated HTML, push, wait for deployment, and verify the actual public URL. Do not create duplicate repositories or use other hosting services.
