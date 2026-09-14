# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [2.0.0](https://github.com/melo-libs/melo-lite/compare/v1.0.0...v2.0.0) (2026-08-30)

> The macOS downloads for this release are unsigned. macOS may require approval in
> System Settings → Privacy & Security before the app can be opened. Moving from
> this release to a future signed build may require a manual reinstall.

### Highlights

- Rebuilt Melo around local workspaces while preserving single-file editing.
- Added a first-run workspace flow, Inbox, welcome guide, workspace switching and session restore.
- Added fast full-text search, smart folders, wikilinks, backlinks and unlinked mentions.
- Added web clipping with local images, PDF viewing and previews for common media files.
- Added Markdown, standalone HTML and PDF export.

### Editor

- Upgraded to Tiptap 3 and rebuilt the Markdown parsing and serialization pipeline.
- Added richer tables, task lists, math, code blocks, slash commands and block drag controls.
- Added Markdown-aware paste, local image handling, find and replace, multi-tab editing and configurable typography.
- Improved autosave, external-change reconciliation and unsaved-document handling.

### Workspace and reliability

- Added a scalable native workspace watcher and incremental SQLite index for large folders.
- Added external file-change handling, file moves, clipboard paste and a searchable move dialog.
- Added English and Simplified Chinese interfaces and refreshed the application layout.
- Isolated development update checks and hardened stable-channel update settings.

## 1.0.0 (2025-04-21)


### ⚡️ Performance Improvements

* adjust window default width and height ([91cdc92](https://github.com/melo-libs/melo-lite/commit/91cdc92d225c30e89cc0bfd4829bc68db2459c2b))
* beautify the table menus ([47b8039](https://github.com/melo-libs/melo-lite/commit/47b80395e51dc90e013c290aea4eb0286bbeaffa))
* highlight style ([85ead88](https://github.com/melo-libs/melo-lite/commit/85ead888bb6dbe73948127c51de102a6dc1843ac))
* list style ([9d4e87a](https://github.com/melo-libs/melo-lite/commit/9d4e87aee25eea576338b9c9b73d955b646dd699))
* main window startup ([23fd060](https://github.com/melo-libs/melo-lite/commit/23fd0604f8ad7b5597e9106ab374916a52195e7a))
* optimize performance ([e29ad56](https://github.com/melo-libs/melo-lite/commit/e29ad569c1110e50669e04783a4e50324a5f739e))
* perf css ([35be886](https://github.com/melo-libs/melo-lite/commit/35be886ff78d1e891aa1b877185ff253170e2721))
* print style ([c498006](https://github.com/melo-libs/melo-lite/commit/c4980067bcf3f82cfc7361a45c4431b4941d3388))
* reduce rerendering ([d0b1dab](https://github.com/melo-libs/melo-lite/commit/d0b1dab4f7c0c64cfa3b86700945a6ebd9569baa))
* **sidebar:** refresh filetree silently after pasting ([59c3f7c](https://github.com/melo-libs/melo-lite/commit/59c3f7c2730062fff7a2f81567172b5e3c9f37fe))
* table menu style ([6288097](https://github.com/melo-libs/melo-lite/commit/6288097daa0bdc93de9498627349ef4f9c90f9cf))
* text menu highlight style ([e3d987a](https://github.com/melo-libs/melo-lite/commit/e3d987ab4fa4d306605bb72c16760d8b14546acf))
* try to reduce bundle size ([8ba5568](https://github.com/melo-libs/melo-lite/commit/8ba5568b3e44390ddfe3f975c640d75fd2d63fd0))


### ♻️ Code Refactoring

* auto save ([e8f6ca1](https://github.com/melo-libs/melo-lite/commit/e8f6ca1c0a81097e4ec5f2b9940ba52b0a8f8635))
* **deps:** replace lodash with custom clamp implementation ([c8f5bb2](https://github.com/melo-libs/melo-lite/commit/c8f5bb2fa736223aa615c5888dae22e0da886d0e))
* **filetree:** extract file tree functions to utils ([498f736](https://github.com/melo-libs/melo-lite/commit/498f73601ccc07375b0b8a9cabc6653fd88ac308))
* reduce lucide bundle size ([3cc6f51](https://github.com/melo-libs/melo-lite/commit/3cc6f517577a488513fff17105c1d2e2a59dac55))
* reexport with named ([921d9ea](https://github.com/melo-libs/melo-lite/commit/921d9ea67df345a16a244d491d9f21191774c482))
* remove console.log ([65d61dd](https://github.com/melo-libs/melo-lite/commit/65d61dd3fc316400f362f570136048949bbb1011))
* remove dev log ([c7e04af](https://github.com/melo-libs/melo-lite/commit/c7e04afb8611abb8584012e92abbbbdd15199a95))
* remove useless code ([35ff51d](https://github.com/melo-libs/melo-lite/commit/35ff51d8ada60a5ef8c22da937f2876f09f7f1f6))
* remove useless file ([d70ed1b](https://github.com/melo-libs/melo-lite/commit/d70ed1bc675239f9d3f7f0970b2b13241a1ab6ce))
* **sidebar:** refactor sidebar ([085d697](https://github.com/melo-libs/melo-lite/commit/085d697d413e1aa6c99160aee29007dd6512ceba))


### 🔧 Chore

* add missing package ([a20afa2](https://github.com/melo-libs/melo-lite/commit/a20afa243ed6f565dda0a158fdbaf5348574d1f7))
* hidden unused icon in toolbar ([b0d25b9](https://github.com/melo-libs/melo-lite/commit/b0d25b95348c3679554dda329462a8f58a197e3a))
* **release:** 🔖 1.0.0 ([7e35729](https://github.com/melo-libs/melo-lite/commit/7e357296727ef6a8b633f53811faebcc6fed3ae0))
* remove dev log ([147eebd](https://github.com/melo-libs/melo-lite/commit/147eebdcc511e7b89f4647eb38c47987fbf920cf))
* remove useless code ([0db3856](https://github.com/melo-libs/melo-lite/commit/0db3856f434bbbf038e3ecc39900d148b2519679))
* update nextui and tailwindcss ([43d8013](https://github.com/melo-libs/melo-lite/commit/43d8013809e203f8502469d167a49805cedb3b5d))
* update react-router ([da4924f](https://github.com/melo-libs/melo-lite/commit/da4924fd410f0b244687a8679f5c751e163916f3))
* update sass ([79c03ee](https://github.com/melo-libs/melo-lite/commit/79c03ee9586aa2648f7ff8827998c171c83a57a9))
* update tiptap ([2998ce9](https://github.com/melo-libs/melo-lite/commit/2998ce9ef4e2c300102a135e3cd3dd53027a9dea))
* update tsconfig for preload script ([93d9007](https://github.com/melo-libs/melo-lite/commit/93d9007250df304728a78976b5c1dc90dda60567))
* upgrade nextui ([7754e25](https://github.com/melo-libs/melo-lite/commit/7754e252ee4d417dda322d461bef0dcaa963b770))


### ✨ Features

* add custom paragragh plugin to turndown ([3982465](https://github.com/melo-libs/melo-lite/commit/398246586c2852c12e49c82fde9f218e50dbd15d))
* add file manager ([e4e1382](https://github.com/melo-libs/melo-lite/commit/e4e1382459e387f9f34d92fdec67a118e69d2a47))
* add InvisibleCharacters plugin to eidtor for debug ([8a496e9](https://github.com/melo-libs/melo-lite/commit/8a496e91f3363f756dea1e9f43ea4caddd628dfd))
* add loading delay to editor ([29f37d3](https://github.com/melo-libs/melo-lite/commit/29f37d3f0dc1513b0cf443019f2137088a9da2e2))
* add loading delay to editor ([51776a8](https://github.com/melo-libs/melo-lite/commit/51776a8f4817081b2bec1302a05bcdc668eaaa58))
* add markdown-it-mark ([1ac1a6a](https://github.com/melo-libs/melo-lite/commit/1ac1a6a26df099708cf49674915e7a7717b26d95))
* add selected markdown file to recently opened ([cf1597b](https://github.com/melo-libs/melo-lite/commit/cf1597b603433168948705bd4b74352fe5e847a8))
* add space to image bottom ([5d6242e](https://github.com/melo-libs/melo-lite/commit/5d6242e86a97b1ba1dc52c40776e432cd0ab2fe5))
* add toc extension ([aee67a4](https://github.com/melo-libs/melo-lite/commit/aee67a4e7549274514331b2b27bef08d4836cf31))
* add tooltip for highlight ([1dbe905](https://github.com/melo-libs/melo-lite/commit/1dbe9057d795c0d560e1fc2299882919f0bd083c))
* add trailing node extension ([ba872e3](https://github.com/melo-libs/melo-lite/commit/ba872e399f4da895d95a7ef027abe3c0df6e941b))
* add turndown plugin listItem ([169ecae](https://github.com/melo-libs/melo-lite/commit/169ecaedf9ab714770b529c5b76ef2d2be29bea1))
* add turndown plugin strikethrough ([a0a0970](https://github.com/melo-libs/melo-lite/commit/a0a09701e580439bd5590bef7aaf86a7c2d31604))
* add turndown table plugin ([b3c51e3](https://github.com/melo-libs/melo-lite/commit/b3c51e3c685bd34dcda2798296ad1677b038479e))
* add turndown tastItem plugin ([72fe894](https://github.com/melo-libs/melo-lite/commit/72fe894bf00cdf20cf176b19ae3ea7eca0102378))
* add warning for unsaved changes in new files ([e9f70ec](https://github.com/melo-libs/melo-lite/commit/e9f70ec9a261fabc1224ac69c3e2e6f9d30d995b))
* adjust editor loading delay to 100ms ([8875938](https://github.com/melo-libs/melo-lite/commit/887593858d2fc3eb33c180ca82f6d3cc913b03b8))
* adjust print style of table ([74e97fa](https://github.com/melo-libs/melo-lite/commit/74e97fa42c46053797a9578d780684092abb484f))
* adjust window size ([d34467e](https://github.com/melo-libs/melo-lite/commit/d34467e2630bc019ed8a8cb422b25a29ca88a5a4))
* auto select filename when renaming ([86b426b](https://github.com/melo-libs/melo-lite/commit/86b426b4af4ef156dc7112163fba668f3cddef7c))
* basic format support ([8239620](https://github.com/melo-libs/melo-lite/commit/82396204cfc2fe697de918e50696ac7293e6bc99))
* beautify nested list style type ([8638455](https://github.com/melo-libs/melo-lite/commit/8638455aba5f94cffee2b0974e236619abca69c1))
* beautify sidebar ([9399146](https://github.com/melo-libs/melo-lite/commit/9399146b356b0e8183a2d437f60f002a3de1c82b))
* build api pipeline ([9470038](https://github.com/melo-libs/melo-lite/commit/9470038acf863b368732672f6caaacd422cdc834))
* change name ([d58269a](https://github.com/melo-libs/melo-lite/commit/d58269a3930a03672763c91b73851cd08c7146e5))
* code block style ([844477b](https://github.com/melo-libs/melo-lite/commit/844477b42bcbb1463f37f4255878ebbdb3ade990))
* completely hide the sidebar when collapsed ([1ca4c69](https://github.com/melo-libs/melo-lite/commit/1ca4c694793d6d453c58c08662126384f71ba9f5))
* config builder for mac file associations ([a2b45c0](https://github.com/melo-libs/melo-lite/commit/a2b45c081cf1f13a79dd29d7687a6f86e799550a))
* custom menu and refactor preload channel api ([b1a1d5f](https://github.com/melo-libs/melo-lite/commit/b1a1d5f8235cd07a2b453ecc9b5167a21113a00e))
* edit file in filetree ([4124d9f](https://github.com/melo-libs/melo-lite/commit/4124d9f05be7b9b93b324cf5f5ffda04b229236d))
* **editor:** add loading mask to editor ([55bc5f9](https://github.com/melo-libs/melo-lite/commit/55bc5f94c76b9a5c6ce60de76790503414cb9cd9))
* **editor:** adjust link menu editor width ([0329531](https://github.com/melo-libs/melo-lite/commit/0329531aa3dfac1a175a874731aed4bab68f6984))
* **editor:** basic toc ([ac62568](https://github.com/melo-libs/melo-lite/commit/ac62568b6cae2f8bbda8e497cf827169463b1696))
* **editor:** beautify image menu ([07c21cf](https://github.com/melo-libs/melo-lite/commit/07c21cf7ce0fb6be530271928c9ecd7aa2c25462))
* **editor:** beautify toc ([774e838](https://github.com/melo-libs/melo-lite/commit/774e838702f8a08767c7ba30b7dae36f074b2a36))
* **editor:** implement image menu ([86b5167](https://github.com/melo-libs/melo-lite/commit/86b5167b1861b5c0d7df3f1c4d902701056a42de))
* **editor:** improve markdown detection in paste handler ([e68631d](https://github.com/melo-libs/melo-lite/commit/e68631d8551a225db47f9766a7f121b6973b1076))
* **editor:** preserve white space ([f297455](https://github.com/melo-libs/melo-lite/commit/f297455d55c25288d562ca15b1b8a4b748402434))
* **editor:** remove toc if none ([f0ca16b](https://github.com/melo-libs/melo-lite/commit/f0ca16b661a8e94cc162fa24d8bd4956e476f76d))
* **editor:** remove TocEmptyState ([742dfc7](https://github.com/melo-libs/melo-lite/commit/742dfc74dfecc254e449e1e34fdfa007ed343d42))
* **editor:** revert to antd select ([ebac4dd](https://github.com/melo-libs/melo-lite/commit/ebac4dd1fc75c768565a22c90da909e5b4cdfe29))
* **editor:** saving file before changing selected file ([7dc4d86](https://github.com/melo-libs/melo-lite/commit/7dc4d8652fe659d5f296e024a6c1b9c8a65b3612))
* **editor:** set bold, highlight, italic, strike keepOnSplit to false ([cc5eacc](https://github.com/melo-libs/melo-lite/commit/cc5eaccef8e070f9ff374835218182a000a2ca25))
* **editor:** store image to file system ([047fe5f](https://github.com/melo-libs/melo-lite/commit/047fe5f97db40e59a2d7236a93723809f43da440))
* **editor:** using custom bullet list ([fed27d8](https://github.com/melo-libs/melo-lite/commit/fed27d8d36b1f497843f362e5c319411c11d05ca))
* enhance error indication in the filetree input UI element ([d13da89](https://github.com/melo-libs/melo-lite/commit/d13da89501035b5e319b4b22d38de1303218df53))
* export pdf using puppeteer ([a827831](https://github.com/melo-libs/melo-lite/commit/a827831f14c3bb5aa048e89d75705315abbb8062))
* **filetree:** enhance file creation UX with default markdown extension ([f5009d8](https://github.com/melo-libs/melo-lite/commit/f5009d824069b60ccced4224cdd8b4e39564b211))
* **filetree:** handle delete folder containing opened file ([fe82ce6](https://github.com/melo-libs/melo-lite/commit/fe82ce65708480c505ee876bfd9afc71abebc844))
* **filetree:** remove cursor-point in filetree ([952f0e5](https://github.com/melo-libs/melo-lite/commit/952f0e5833988bd2cb88aa1756b48d4b212c8d90))
* **filetree:** show extension in filetree ([d9d1149](https://github.com/melo-libs/melo-lite/commit/d9d114903754f7806c4715a29e1fb3c3dd80b2b4))
* handle input composing and make sidebar cannot selected ([9955f49](https://github.com/melo-libs/melo-lite/commit/9955f496329ff961c5f1f243db21ae3e3f049555))
* image render ([8e50364](https://github.com/melo-libs/melo-lite/commit/8e5036484999fdc3e495764e7b076c5b4a70308a))
* implement remark mark plugin ([27fa2f1](https://github.com/melo-libs/melo-lite/commit/27fa2f152f9e941d16c447c370215bd55f22f366))
* improve last modified time display format ([fa2c28e](https://github.com/melo-libs/melo-lite/commit/fa2c28e09c162fc25419f228324b72cfb63fb82a))
* improve save, save as, and export to pdf features ([1b711a1](https://github.com/melo-libs/melo-lite/commit/1b711a1ba09579a8b6bc8ad9771705730274357e))
* language select for code block ([03211ce](https://github.com/melo-libs/melo-lite/commit/03211ceb03a73ac33de8280a9516e17c11638af4))
* layout ([6131384](https://github.com/melo-libs/melo-lite/commit/61313847ecabbc5f61ec5413bc90c84a280c52ad))
* layout ([8010f43](https://github.com/melo-libs/melo-lite/commit/8010f4365c4bf95a05b73cc1c63f8b3badea3a53))
* make sidebar be hidden by default ([7fd192e](https://github.com/melo-libs/melo-lite/commit/7fd192e6426446b078f73bc9017c3d5ff3057f0b))
* make toc dynamic update with doc scrolling ([6a1d34e](https://github.com/melo-libs/melo-lite/commit/6a1d34e1c4a093c8d323ca3b9676be117301d4cd))
* make toolbar draggable ([81db419](https://github.com/melo-libs/melo-lite/commit/81db419e66cc0f2fc832046bca1c1167c3f2e54e))
* markdown serialier support highlight ([b4d2e83](https://github.com/melo-libs/melo-lite/commit/b4d2e83572c6abc81614e297aec596a672973b88))
* memo sidebar collapsed status ([ab12661](https://github.com/melo-libs/melo-lite/commit/ab12661eb28022813613fdc7e76099a5314d592f))
* **menu:** add Report Issue option to Help menu ([488aba6](https://github.com/melo-libs/melo-lite/commit/488aba609d87aa5b89f5f76e748b99d2de54f3ab))
* omit hidden files in api ([d5c374f](https://github.com/melo-libs/melo-lite/commit/d5c374fd47270ce9df538207ada12e594fbdc813))
* perf highlight style ([857c499](https://github.com/melo-libs/melo-lite/commit/857c499fe05ca7867212e2c7d5dfa5aac53e9f9d))
* **release:** implement automated release workflow ([7c13262](https://github.com/melo-libs/melo-lite/commit/7c1326209b1879611954bdec22008172f67c9041))
* remember last opened directory ([963d606](https://github.com/melo-libs/melo-lite/commit/963d606c34eed3b668ce57e0f1b6ccfa68464226))
* remove animation in filetree select ([341a08c](https://github.com/melo-libs/melo-lite/commit/341a08cc1fc93d932fe779d89a10cddcdb118b99))
* remove file search ui ([0001105](https://github.com/melo-libs/melo-lite/commit/0001105fb8e6245c00af09da3baba3e962f86587))
* remove format menu ([0716e85](https://github.com/melo-libs/melo-lite/commit/0716e85677aefa3efa03da2f7c61fa0622ba6699))
* remove save as ([833ff4a](https://github.com/melo-libs/melo-lite/commit/833ff4a53e4d4b584d956098fc58d1a94129eeed))
* remove toc slash command ([3ad9f3a](https://github.com/melo-libs/melo-lite/commit/3ad9f3ab052118506a0ac70dd718e7a93c0f7718))
* rewrite highlight ([1c6998b](https://github.com/melo-libs/melo-lite/commit/1c6998b3efb3e386d00de3a4e9a2753875dd1f7b))
* rich text link support ([7a57061](https://github.com/melo-libs/melo-lite/commit/7a570619ec12cc0845e4dfa486bcd29df8300481))
* set image inline ([602a28c](https://github.com/melo-libs/melo-lite/commit/602a28c52bb8152ea9c20887dc08af1a9310e224))
* sidebar header show current root directory ([c528d18](https://github.com/melo-libs/melo-lite/commit/c528d18bd4328396e0ffd66c9df70fc534ee899c))
* **sidebar:** outline context menu select file or folder ([ae115e4](https://github.com/melo-libs/melo-lite/commit/ae115e457ea4ee75f595b18cb1f6629695c21cbe))
* **sidebar:** paste support ([b68b046](https://github.com/melo-libs/melo-lite/commit/b68b0463fde51685c52d9fa0e31632ba674f9d35))
* **sidebar:** select the file or folder automatically after creation ([09605a8](https://github.com/melo-libs/melo-lite/commit/09605a81b07d66ff770a5b167ea4876b45d4f0aa))
* **sidebar:** support create file and folder in root directory ([c82c696](https://github.com/melo-libs/melo-lite/commit/c82c6965a86f800a7100d3f99003680cd958138b))
* support auto update ([c919b4a](https://github.com/melo-libs/melo-lite/commit/c919b4ade0a3cf4a1f93cfd002df22c6e3067dcd))
* support basic markdown-it task list ([96f393c](https://github.com/melo-libs/melo-lite/commit/96f393cc5e33de7c55bca5fa21c8fcd38a77038f))
* support data image on pasting ([17cbd62](https://github.com/melo-libs/melo-lite/commit/17cbd625cca266122066b84003c264abce388688))
* support math ([db851c0](https://github.com/melo-libs/melo-lite/commit/db851c07573949547cfc0d5f1e18c520378a733d))
* support move file by dragging ([90c72b0](https://github.com/melo-libs/melo-lite/commit/90c72b00ccba204fd89507f839a4608f19c24df7))
* support open recently ([6597354](https://github.com/melo-libs/melo-lite/commit/65973549700b8e15c93a3c596a31e8c64ae74a9f))
* support open, save, save as ([7afe0e0](https://github.com/melo-libs/melo-lite/commit/7afe0e0a7651525629a173ebe133cc06808fd7a6))
* support quick preview and check path exists ([4e9e31b](https://github.com/melo-libs/melo-lite/commit/4e9e31be04741cd12108d45c2b35b5d16f8bff19))
* support reveal in finder ([8ae076f](https://github.com/melo-libs/melo-lite/commit/8ae076fe5992978f7e0c1d1e22aa86114ca39c2e))
* support search and replace ([a52bdf3](https://github.com/melo-libs/melo-lite/commit/a52bdf32bb057d9007f5eb3dbdc9a1062a7ec7df))
* support skip updating if ignored ([d415ab5](https://github.com/melo-libs/melo-lite/commit/d415ab506efed8b24d6c95232d77cfe523fa20e6))
* support words count ([b072cea](https://github.com/melo-libs/melo-lite/commit/b072ceaca8ec6842c9e84cf3a464743d02e78fb0))
* table support ([b206960](https://github.com/melo-libs/melo-lite/commit/b206960f40e0cfe1cb954932f31d751819e78dba))
* typograph style ([8fa68d8](https://github.com/melo-libs/melo-lite/commit/8fa68d8c032ea4f4821136b040fc751434e72f2b))
* update app icon ([cbae11c](https://github.com/melo-libs/melo-lite/commit/cbae11cd28fd49e0836114efcb50ca8de4e0097d))
* update website address ([0f8286e](https://github.com/melo-libs/melo-lite/commit/0f8286ea325a02332bbacc95fea8983ddf7e6f65))
* upgrade tiptap and extensions ([6ae9e5e](https://github.com/melo-libs/melo-lite/commit/6ae9e5ebfe81f8cbeeb0083eafc6cfd6ec929882))


### 🐛 Bug Fixes

* adjust text ([9a1c51e](https://github.com/melo-libs/melo-lite/commit/9a1c51e1b8c393540242f6ff766ae54791bbc3ae))
* allow highlight text to appear anywhere in the line ([ec4a9ec](https://github.com/melo-libs/melo-lite/commit/ec4a9ecabf7f08b8c25e7122236a7b7cb5c5fdae))
* allow italic text to appear anywhere in the line ([53ef007](https://github.com/melo-libs/melo-lite/commit/53ef007cae5364ba806e47428d786a7de630cf3a))
* allow strike text to appear anywhere in the line ([5c463f3](https://github.com/melo-libs/melo-lite/commit/5c463f32c9297dc26b3f81c92f4aacae7040e09d))
* app route ([addae67](https://github.com/melo-libs/melo-lite/commit/addae672681c15d322830a0c131a5d349a0dde45))
* cannot open file if window is closed ([8260617](https://github.com/melo-libs/melo-lite/commit/826061711326d1efc1db94bba28c3c8160c9f371))
* character count not refreshed ([55b40cd](https://github.com/melo-libs/melo-lite/commit/55b40cdf41a08586ee30f02fca00b92d2a107fdc))
* checking name conflict while renaming ([ace3a70](https://github.com/melo-libs/melo-lite/commit/ace3a70f0e0f1615a2c066c5270c8f2c90bf7995))
* clear history while switching to another file ([ff82024](https://github.com/melo-libs/melo-lite/commit/ff82024fd3590ec0f7427d0fbc8f1c72191ae047))
* disable shouldDiscard check if select file to preview ([d35f1de](https://github.com/melo-libs/melo-lite/commit/d35f1decd90c42aff00388232672b01df487b6bd))
* dont show error toast when save is cancelled ([4877055](https://github.com/melo-libs/melo-lite/commit/48770555a9cebf92ca83d800b130d0b37e701fd3))
* **editor:** adapting styles for extremely long toc ([8c5f6dc](https://github.com/melo-libs/melo-lite/commit/8c5f6dcb4a1f0ea273a1e49bc6d1e96ec402ea7a))
* **editor:** allow bold text to appear anywhere in the line ([771ec15](https://github.com/melo-libs/melo-lite/commit/771ec151196adb553f8912e385156b27a0878e46))
* **editor:** file saving ([6198828](https://github.com/melo-libs/melo-lite/commit/6198828b2ad2b443be8015d085ec2fcc87df64d7))
* **editor:** make link style break all ([7392eee](https://github.com/melo-libs/melo-lite/commit/7392eee3a0e1c3d4d63e174fee6dfb583e6a50e5))
* **editor:** remove duplicated logic ([e5d6617](https://github.com/melo-libs/melo-lite/commit/e5d661706af2899bb6428b59a7902bf78d8dd1b6))
* **editor:** save and save as ([cbbdc25](https://github.com/melo-libs/melo-lite/commit/cbbdc25dc6c3688d5efca2e3ebcf09a3a6b5965a))
* **editor:** text menu cannot be opened ([36222f5](https://github.com/melo-libs/melo-lite/commit/36222f5f2ab26998f48acfd435370e6979059f09))
* **editor:** type error ([612eeee](https://github.com/melo-libs/melo-lite/commit/612eeeeb2066e8f40a7f86bbbfc9b2eeaec03b46))
* export pdf with puppeteer missing chrome ([31ba27b](https://github.com/melo-libs/melo-lite/commit/31ba27bf7ce08c354a43d757a4d1ce7d812e9ef9))
* **filetree:** warning text ([53874f2](https://github.com/melo-libs/melo-lite/commit/53874f236bb3536800acba8e4e604a2b409b8ea1))
* findIndex and findLength is not updated ([e7871e1](https://github.com/melo-libs/melo-lite/commit/e7871e1e22cddbefc001c80dee7f7379bd699851))
* html fomat broken after pasting ([b9800fd](https://github.com/melo-libs/melo-lite/commit/b9800fd971ebcf8bb1260259577bf643b23e9ca8))
* ignore file move operation when target is same directory ([0e6a759](https://github.com/melo-libs/melo-lite/commit/0e6a759fa52e9353bcfdee4d23bf81b1e37106ed))
* image style while exporting to pdf ([d0bd59b](https://github.com/melo-libs/melo-lite/commit/d0bd59b290d2736e5b38527d58bd91f9ac0a5bc4))
* implement PDF export functionality ([a94fc4b](https://github.com/melo-libs/melo-lite/commit/a94fc4b0608dda43a1a5c352a29465fabb8ab4a0))
* italic and bold markdown regex ([3e713b5](https://github.com/melo-libs/melo-lite/commit/3e713b558d1b281887feffb9201be74f055b88d4))
* **layout:** header padding size adjust ([31d957c](https://github.com/melo-libs/melo-lite/commit/31d957c0e86776c83995972e0f3bfc5af151b432))
* **main:** export large document to pdf will be broken using loadURL ([f48bdf2](https://github.com/melo-libs/melo-lite/commit/f48bdf2cbec578e26543570d87092aa1f913f1cc))
* **pdf:** allow PDF export for unsaved documents ([a0f0ec6](https://github.com/melo-libs/melo-lite/commit/a0f0ec679481a867137d872b2984ef8a506e42c7))
* press enter in findAndReplace cannot be triggered ([18a21a6](https://github.com/melo-libs/melo-lite/commit/18a21a63753651c33f66d1985e14cc22f8b3aaad))
* prettier lint ([caca3cf](https://github.com/melo-libs/melo-lite/commit/caca3cf8599651d8d7e81f837ad5cb60ee061f8c))
* prevent child elements from triggering parent click event ([cc220db](https://github.com/melo-libs/melo-lite/commit/cc220db90fd1195e1465d305c04f7b0b1dfdd8ba))
* remove incorrect shortcut for setting link ([28f95c1](https://github.com/melo-libs/melo-lite/commit/28f95c1e5e0692ece0eed247d298186bb6760156))
* remove unexpected blank line that occurs after the first block during markdown paste insertion ([55e08f4](https://github.com/melo-libs/melo-lite/commit/55e08f4883559d2bb5b4952709cb74b5cc6dcd36))
* return silently if operation was cancelled by user ([04c7d9b](https://github.com/melo-libs/melo-lite/commit/04c7d9bc97100599987e9d6cfcb0ce7418ea16cc))
* **sidebar:** auto selete file after creating ([f53e0b2](https://github.com/melo-libs/melo-lite/commit/f53e0b24581183c68689da8f73e51846dee12030))
* strike shortcut ([5daff78](https://github.com/melo-libs/melo-lite/commit/5daff78beb72ea57c15fa36b566d32f91da06ffd))
* sync sidebar selection with current opened file ([cc26a89](https://github.com/melo-libs/melo-lite/commit/cc26a8989fba971f7ff3df6a187134d16166b7e9))
* table column menu ([035e3fe](https://github.com/melo-libs/melo-lite/commit/035e3fe2c260016ad4c8a9a61754f974ac95ca7f))
* table menu missing when only one column or row ([0ed736c](https://github.com/melo-libs/melo-lite/commit/0ed736c527c2e77520ed31d82174ac56d437d5ff))
* tailwindcss config ([81abf1b](https://github.com/melo-libs/melo-lite/commit/81abf1b29ffc096b301e2542d49be37d740a1310))
* task item parse and serialize ([d74c176](https://github.com/melo-libs/melo-lite/commit/d74c176cdea699e50da5e41b85353886041d15b2))
* textmenu broken after setting editor shouldRerenderOnTransaction to false ([7002eee](https://github.com/melo-libs/melo-lite/commit/7002eee03b2671f691afd46afb29ab4e707f8376))
* TextMenuContent not updated after changing the type ([ff49c55](https://github.com/melo-libs/melo-lite/commit/ff49c5530802f0986dbd14e6b9ca9fdc050a947d))
* typescript error ([d9f00b5](https://github.com/melo-libs/melo-lite/commit/d9f00b53d58f053f0aedc778a9745bfcc8165e71))
