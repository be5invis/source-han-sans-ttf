"use strict";

const { Ot, FontIo } = require("ot-builder");
const fs = require("fs-extra");

module.exports = async function pass(argv) {
	const sfnt = FontIo.readSfntOtf(await fs.readFile(argv.from));
	const font = FontIo.readFont(sfnt, Ot.ListGlyphStoreFactory);
	nameFont(font, argv.config.prefix, argv.config.naming, argv.weight, argv.region);

	const sfntOut = FontIo.writeFont(font);
	await fs.writeFile(argv.to, FontIo.writeSfntOtf(sfntOut));
};

///////////////////////////////////////////////////////////////////////////////////////////////////

function nameEntry(table, l, n, str) {
	table.records.push({
		platformID: 3,
		encodingID: 1,
		languageID: l,
		nameID: n,
		value: str,
	});
}

function compatibilityName(family, style) {
	if (style === "Regular" || style === "Bold" || style === "Italic" || style === "Bold Italic") {
		return { family, style, standardFour: true };
	} else {
		if (/^Extra/.test(style)) {
			// Prevent name overflow
			style = style.replace(/^Extra/, "X");
		}
		if (/Italic/.test(style)) {
			return {
				family: family + " " + style.replace(/Italic/, "").trim(),
				style: "Italic",
				standardFour: false,
			};
		} else {
			return { family: family + " " + style, style: "Regular", standardFour: false };
		}
	}
}

const langIDMap = {
	en_US: 1033,
	zh_CN: 2052,
	zh_TW: 1028,
	zh_HK: 3076,
	ja_JP: 1041,
	ko_KR: 1042,
};

function createNameTuple(table, langID, prefix, region, style) {
	const family = (prefix + " " + region).trim();

	nameEntry(table, langID, Ot.Name.NameID.PreferredFamily, family);
	nameEntry(table, langID, Ot.Name.NameID.PreferredSubfamily, style);

	const compat = compatibilityName(family, style);
	const compatStyle = compat.standardFour ? style : compat.style;
	nameEntry(table, langID, Ot.Name.NameID.LegacyFamily, compat.family);
	nameEntry(table, langID, Ot.Name.NameID.LegacySubfamily, compatStyle);

	if (compatStyle === "Regular") {
		nameEntry(table, langID, Ot.Name.NameID.FullFontName, `${compat.family}`);
	} else {
		nameEntry(table, langID, Ot.Name.NameID.FullFontName, `${compat.family} ${compatStyle}`);
	}
	nameEntry(table, langID, Ot.Name.NameID.UniqueFontId, `${family} ${style}`);
}

function nameFont(font, prefix, namings, style, region) {
	const nameTable = new Ot.Name.Table();

	for (let language in langIDMap) {
		const langID = langIDMap[language];
		createNameTuple(nameTable, langID, namings.familyName[language], region, style);

		if (language === "en_US") {
			if (namings.copyright) {
				nameEntry(nameTable, langID, Ot.Name.NameID.Copyright, namings.copyright);
			}
			if (namings.version) {
				nameEntry(nameTable, langID, Ot.Name.NameID.VersionString, namings.version);
			}
			if (namings.manufacturer) {
				nameEntry(nameTable, langID, Ot.Name.NameID.Manufacturer, namings.copyright);
			}
			if (namings.trademark) {
				nameEntry(nameTable, langID, Ot.Name.NameID.Trademark, namings.trademark);
			}
			if (namings.designer) {
				nameEntry(nameTable, langID, Ot.Name.NameID.Designer, namings.designer);
			}

			nameEntry(
				nameTable,
				langID,
				Ot.Name.NameID.PostscriptName,
				`${prefix}${region}-${style}`
			);
		}
	}

	// Canonical ordering
	nameTable.records.sort((a, b) => {
		if (a.platformID < b.platformID) return -1;
		if (a.platformID > b.platformID) return 1;
		if (a.encodingID < b.encodingID) return -1;
		if (a.encodingID > b.encodingID) return 1;
		if (a.languageID < b.languageID) return -1;
		if (a.languageID > b.languageID) return 1;
		if (a.nameID < b.nameID) return -1;
		if (a.nameID > b.nameID) return 1;
	});

	font.name = nameTable;
}
