"use strict";

const os = require("os");
const fs = require("fs-extra");
const build = require("verda").create();
const { task, file, oracle } = build.ruleTypes;
const { de, fu } = build.rules;
const { run, rm, cd, mv, cp } = build.actions;

const BUILD = `.build`;
const SRC = `src`;
const OUT = `out`;
const HINT_CONFIG = `hint-config`;

const NODEJS = `node`;
const OTF2OTC = `otf2otc`;
const OTC2OTF = `otc2otf`;
const OTF2TTF = `otf2ttf`;
const TTFAUTOHINT = `ttfautohint`;
const SEVEN_ZIP = `7z`;

build.setJournal(`build/.verda-build-journal`);
build.setSelfTracking();
module.exports = build;

///////////////////////////////////////////////////////////////////////////////////////////////////
// Pass 1
const PASS1 = `${BUILD}/pass1`;
const BreakTtc = task.make(
	(weight) => `break-ttc::${weight}`,
	async ($, weight) => {
		const [config] = await $.need(Config, Dependencies, de(PASS1));
		await run(OTC2OTF, `${SRC}/${config.prefix}-${weight}.ttc`);
		for (const suffix of config.allRegions) {
			const partName = `${FontFileName(config, suffix, weight)}.otf`;
			if (await fs.pathExists(`${SRC}/${partName}`)) {
				await rm(`${PASS1}/${partName}`);
				await mv(`${SRC}/${partName}`, `${PASS1}/${partName}`);
			}
		}
	}
);
const Pass1Otf = file.make(
	(init, weight) => `${PASS1}/${init}-${weight}.otf`,
	async ($, output, init, weight) => {
		await $.need(BreakTtc(weight));
	}
);
const Pass1Ttf = file.make(
	(init, weight) => `${PASS1}/${init}-${weight}.ttf`,
	async ($, output, init, weight) => {
		const [input] = await $.need(Pass1Otf(init, weight));
		await run(OTF2TTF, "-o", output.full, input.full);
	}
);

function FontFileName(config, suffix, weight) {
	return `${config.prefix}${suffix}-${weight}`;
}
function GroupFileNamesT(config, weight, fn) {
	const results = [];
	for (const suffix of config.regions) {
		results.push(fn(`${config.prefix}${suffix}`, `${weight}`));
	}
	return results;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Pass 2

const PASS2 = `${BUILD}/pass2`;
const Pass2Ttc = file.make(
	(init, weight) => `${PASS2}/${init}-${weight}.ttc`,
	async ($, output, init, weight) => {
		const [config] = await $.need(Config, de(PASS2));
		const ttfTasks = GroupFileNamesT(config, weight, Pass1Ttf);

		const [input] = await $.need(ttfTasks);

		const tempTtc = `${output.dir}/${output.name}.temp.ttc`;
		await run(
			OTF2OTC,
			[`-o`, tempTtc],
			input.map((x) => x.full)
		);
		await run(TTFAUTOHINT, tempTtc, output.full);
		await rm(tempTtc);
		await run(OTC2OTF, output.full);
	}
);
const Pass2Ttf = file.make(
	(init, weight) => `${PASS2}/${init}-${weight}.ttf`,
	async ($, output, init, weight) => {
		const [config] = await $.need(Config, de(PASS2));
		await $.need(Pass2Ttc(config.prefix, weight));
	}
);

///////////////////////////////////////////////////////////////////////////////////////////////////
// Pass 3
const PASS3 = `${BUILD}/pass3`;
const Chlorophytum = [
	NODEJS,
	`--experimental-worker`,
	`--max-old-space-size=8192`,
	`./node_modules/@chlorophytum/cli/lib/index.js`,
];
const Pass3Ttf = file.make(
	(init, weight) => `${PASS3}/${init}-${weight}.ttf`,
	async ($, output, init, weight) => {
		await $.need(de(PASS3));
		const [input] = await $.need(Pass2Ttf(init, weight));
		await cp(input.full, output.full);
	}
);
const GroupHint = task.make(
	(weight) => `group-hint::${weight}`,
	async ($, weight) => {
		const [config, jHint, hintConfig] = await $.need(
			Config,
			JHint,
			fu(`${HINT_CONFIG}/${weight}.json`),
			de(PASS3)
		);
		const otdTasks = GroupFileNamesT(config, weight, Pass3Ttf);
		const [inputs] = await $.need(otdTasks);
		await run(
			Chlorophytum,
			`hint`,
			[`-c`, hintConfig.full],
			[`-h`, `${PASS3}/hint-cache-${weight}.gz`],
			[`--jobs`, jHint],
			[...HintParams(inputs)]
		);
	}
);
const HintAll = task(`hint-all`, async ($) => {
	const [config] = await $.need(Config);
	for (const weight of config.weights) {
		await $.need(GroupHint(weight));
	}
});
const GroupInstr = task.make(
	(weight) => `group-instr::${weight}`,
	async ($, weight) => {
		const [config, hintParam] = await $.need(Config, fu(`${HINT_CONFIG}/${weight}.json`));
		const otdTasks = GroupFileNamesT(config, weight, Pass3Ttf);
		const [inputs] = await $.need(otdTasks);
		await $.need(HintAll);
		//await $.need(GroupHint`group-hint::${weight}`);
		await run(Chlorophytum, `instruct`, [`-c`, hintParam.full], [...InstrParams(inputs)]);
	}
);

const OutTtf = `${OUT}/ttf`;
const Pass3TtfOut = file.make(
	(init, weight) => `${OutTtf}/${init}-${weight}.ttf`,
	async (t, output, init, weight) => {
		await t.need(fu(`${HINT_CONFIG}/${weight}.json`), GroupInstr(weight));
	}
);

function* HintParams(fonts) {
	for (const ttf of fonts) {
		yield ttf.full;
		yield `${ttf.dir}/${ttf.name}.hint.gz`;
	}
}
function* InstrParams(fonts) {
	for (const ttf of fonts) {
		yield ttf.full;
		yield `${ttf.dir}/${ttf.name}.hint.gz`;
		yield `${OutTtf}/${ttf.name}.ttf`;
	}
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Pass 4

const OutTtc = `${OUT}/ttc`;
const TTCIZE = ["node", "node_modules/otb-ttc-bundle/bin/otb-ttc-bundle"];
const Pass4Group = file.make(
	(init, weight) => `${OutTtc}/${init}-${weight}.ttc`,
	async ($, output, init, weight) => {
		const [config] = await $.need(Config);
		const [parts] = await $.need(GroupFileNamesT(config, weight, Pass3TtfOut));
		await run(TTCIZE, "-x", ["-o", output.full], [...parts.map((t) => t.full)]);
	}
);
const All = task(`all`, async ($) => {
	const [config] = await $.need(Config);
	await $.need(config.weights.map((w) => Pass4Group(config.prefix, w)));
});

const TTCArchive = file.make(
	(version) => `${OUT}/source-han-sans-ttc-${version}.7z`,
	async (t, target) => {
		await t.need(All);
		await rm(target.full);
		await cd(`${OUT}/ttc`).run(
			[SEVEN_ZIP, `a`],
			[`-t7z`, `-mmt=on`, `-m0=LZMA:a=0:d=1536m:fb=256`],
			[`../${target.name}.7z`, `*.ttc`]
		);
	}
);
const TTFArchive = file.make(
	(version) => `${OUT}/source-han-sans-ttf-${version}.7z`,
	async (t, target) => {
		const [config] = await t.need(Config, de`${OUT}/ttf`);
		await t.need(All);
		await rm(target.full);
		for (const weight of config.weights) {
			await cd(`${OUT}/ttf`).run(
				[SEVEN_ZIP, `a`],
				[`-t7z`, `-mmt=on`, `-m0=LZMA:a=0:d=1536m:fb=256`],
				[`../${target.name}.7z`, `*-${weight}.ttf`]
			);
		}
	}
);

const Release = task(`release`, async ($) => {
	const version = await $.need(Version);
	await $.need(TTFArchive(version), TTCArchive(version));
});

///////////////////////////////////////////////////////////////////////////////////////////////////
// Configuration, directories
const Config = oracle("config", async () => {
	return await fs.readJSON(__dirname + "/config.json");
});
const Version = oracle("oracles::version", async () => {
	const pkg = await fs.readJSON(__dirname + "/package.json");
	return pkg.version;
});
const Dependencies = oracle("oracles::dependencies", async () => {
	const pkg = await fs.readJSON(__dirname + "/package.json");
	const depJson = {};
	for (const pkgName in pkg.dependencies) {
		const depPkg = await fs.readJSON(__dirname + "/node_modules/" + pkgName + "/package.json");
		const depVer = depPkg.version;
		depJson[pkgName] = depVer;
	}
	return { requirements: pkg.dependencies, actual: depJson };
});
const JHint = oracle("hinting-jobs", async () => os.cpus().length);
