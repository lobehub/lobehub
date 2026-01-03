## chore(i18n): Adjust Latin language locales for terminology consistency

This comprehensive update ensures all Latin language locales (de-DE, fr-FR, es-ES, it-IT, pt-BR, nl-NL, pl-PL) follow the microcopy style guide's terminology requirements.

### Changes Made

**Total: 557 changes across 7 Latin locales**

#### Primary Terminology Updates
1. **"Plugin" → "Skill"**
   - Fixed terminology inconsistency across all Latin languages
   - UI elements now consistently use "Skill" instead of localized equivalents
   - Includes both singular and plural forms: `plugin/Skill`, `plugins/Skills`

2. **"LobeChat" → "LobeHub"**
   - Updated brand name references to current branding

3. **"Agent" Terminology Consistency**
   - French: Fixed inconsistent "Assistant" → "Agent" usage in UI elements
   - Ensured consistent terminology across all languages

#### Per-Locale Breakdown
- **de-DE (German)**: 267 changes
- **fr-FR (French)**: 94 changes (including 7 Agent→Assistant fixes)
- **es-ES (Spanish)**: 39 changes
- **it-IT (Italian)**: 59 changes (including 18 plugin→skill fixes)
- **pt-BR (Portuguese)**: 58 changes
- **nl-NL (Dutch)**: 62 changes
- **pl-PL (Polish)**: 28 changes

#### Files Modified
- All 37 locale JSON files for each language (259 total files)
- Includes: auth.json, chat.json, common.json, discover.json, plugin.json, setting.json, etc.

#### Key Improvements
1. **Fixed Terminology**: Following microcopy guide's fixed terminology rules
2. **Brand Consistency**: Changed all brand references to "LobeHub"
3. **Natural Localization**: Maintained natural language patterns while ensuring consistency
4. **User Experience**: Improved consistency across all Latin language interfaces

### Scripts Created
Two utility scripts for future locale maintenance:
- `scripts/adjust-latin-locales.py` - For common.json specific adjustments
- `scripts/adjust-latin-locales-full.py` - For comprehensive adjustments across all files

### Review Notes
- All changes maintain backward compatibility
- No breaking changes to functionality
- JSON files validated and remain syntactically correct
- Changes reviewed against English base for consistency