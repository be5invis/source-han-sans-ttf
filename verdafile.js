"use strict";

const os = require("os");
const fs = require("fs-extra");
const build = require("verda").create();
const { task, tasks, files, oracle, phony } = build.ruleTypes;
const { de, fu } = build.rules;
const { run, rm, cd, mv } = build.actions;
const { FileList } = build.predefinedFuncs;

const BUILD = `build`;
const SRC = `src`;
const OUT = `out`;
const HINT_CONFIG = `hint-config`;

const NODEJS = `node`;
const OTF2OTC = `otf2otc`;
const OTC2OTF = `otc2otf`;
const OTF2TTF = `otf2ttf`;
const OTFCCDUMP = `otfccdump`;
const OTFCCBUILD = `otfccbuild`;
const TTFAUTOHINT = `ttfautohint`;

build.setJournal(`build/.verda-build-journal`);
build.setSelfTracking();
module.exports = build;

///////////////////////////////////////////////////////////////////////////////////////////////////
// Pass 1
const PASS1 = `${BUILD}/pass1`;
const BreakTtc = tasks(`break-ttc::*`, async ($, weight) => {
	const [config] = await $.need(Config, de(PASS1));
	await run(OTC2OTF, `${SRC}/${config.prefix}-${weight}.ttc`);
	for (const suffix of config.allRegions) {
		const partName = `${FontFileName(config, suffix, weight)}.otf`;
		if (await fs.pathExists(`${SRC}/${partName}`)) {
			await rm(`${PASS1}/${partName}`);
			await mv(`${SRC}/${partName}`, `${PASS1}/${partName}`);
		}
	}
});
const Pass1Otf = files(`${PASS1}/*-*.otf`, async ($, { $: [, weight] }) => {
	await $.need(BreakTtc`break-ttc::${weight}`);
});
const Pass1Ttf = files(`${PASS1}/*-*.ttf`, async ($, output) => {
	const [input] = await $.need(Pass1Otf`${output.dir}/${output.name}.otf`);
	await run(OTF2TTF, "-o", output.full, input.full);
});

function FontFileName(config, suffix, weight) {
	return `${config.prefix}${suffix}-${weight}`;
}
function GroupFileNamesT(config, weight, fn) {
	const results = [];
	for (const suffix of config.regions) {
		results.push(fn(`${config.prefix}${suffix}-${weight}`));
	}
	return results;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Pass 2

const PASS2 = `${BUILD}/pass2`;
const Pass2Ttc = files(`${PASS2}/*-*.ttc`, async ($, output) => {
	const [config] = await $.need(Config, de(PASS2));
	const [_prefix, weight] = output.$;
	const ttfTasks = GroupFileNamesT(config, weight, f => Pass1Ttf`${PASS1}/${f}.ttf`);

	const [input] = await $.need(ttfTasks);

	const tempTtc = `${output.dir}/${output.name}.temp.ttc`;
	await run(OTF2OTC, [`-o`, tempTtc], input.map(x => x.full));
	await run(TTFAUTOHINT, tempTtc, output.full);
	await rm(tempTtc);
	await run(OTC2OTF, output.full);
});
const Pass2Ttf = files(`${PASS2}/*-*.ttf`, async ($, output) => {
	const [config] = await $.need(Config, de(PASS2));
	const [_prefix, weight] = output.$;
	await $.need(Pass2Ttc`${output.dir}/${config.prefix}-${weight}.ttc`);
});

///////////////////////////////////////////////////////////////////////////////////////////////////
// Pass 3
const PASS3 = `${BUILD}/pass3`;
const Chlorophytum = [
	NODEJS,
	`--experimental-worker`,
	`--max-old-space-size=8192`,
	`./node_modules/@chlorophytum/cli/lib/index.js`
];
const Pass3Otd = files(`${PASS3}/*-*.otd`, async ($, output) => {
	await $.need(de(PASS3));
	const [input] = await $.need(Pass2Ttf`${PASS2}/${output.name}.ttf`);
	await run(OTFCCDUMP, input.full, "-o", output.full);
});
const GroupHint = tasks(`group-hint::*`, async ($, weight) => {
	const [config, jHint, hintConfig] = await $.need(
		Config,
		JHint,
		fu(`${HINT_CONFIG}/${weight}.json`),
		de(PASS3)
	);
	const otdTasks = GroupFileNamesT(config, weight, f => Pass3Otd`${PASS3}/${f}.otd`);
	const [inputs] = await $.need(otdTasks);
	await run(
		Chlorophytum,
		`hint`,
		[`-c`, hintConfig.full],
		[`-h`, `${PASS3}/hint-cache-${weight}.gz`],
		[`--jobs`, jHint],
		[...HintParams(inputs)]
	);
});
const HintAll = task(`hint-all`, async $ => {
	const [config] = await $.need(Config);
	for (const weight of config.weights) {
		await $.need(GroupHint`group-hint::${weight}`);
	}
});
const GroupInstr = tasks(`group-instr::*`, async ($, weight) => {
	const [config, hintParam] = await $.need(Config, fu(`${HINT_CONFIG}/${weight}.json`));
	const otdTasks = GroupFileNamesT(config, weight, f => Pass3Otd`${PASS3}/${f}.otd`);
	const [inputs] = await $.need(otdTasks);
	//await $.need(GroupHint`group-hint::${weight}`);
	await $.need(HintAll);

	await run(Chlorophytum, `instruct`, [`-c`, hintParam.full], [...InstrParams(inputs)]);
});

function* HintParams(otds) {
	for (const otd of otds) {
		yield otd.full;
		yield `${otd.dir}/${otd.name}.hint.gz`;
	}
}
function* InstrParams(otds) {
	for (const otd of otds) {
		yield otd.full;
		yield `${otd.dir}/${otd.name}.hint.gz`;
		yield `${otd.dir}/${otd.name}.instr.gz`;
	}
}

function* IntegrateParams(from, to, name) {
	yield `${from}/${name}.instr.gz`;
	yield `${from}/${name}.otd`;
	yield `${to}/${name}.otd`;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Pass 4
const PASS4 = `${BUILD}/pass4`;
const Pass4Otd = files(`${PASS4}/*-*.otd`, async (t, { full, name, $: [prefix, weight] }) => {
	const [hintParam] = await t.need(
		fu(`${HINT_CONFIG}/${weight}.json`),
		GroupInstr`group-instr::${weight}`,
		de(`${PASS4}`)
	);
	await run(
		Chlorophytum,
		`integrate`,
		[`-c`, hintParam.full],
		...IntegrateParams(PASS3, PASS4, name)
	);
});

///////////////////////////////////////////////////////////////////////////////////////////////////
// Pass 5

const PASS5 = `${OUT}`;
const Pass5Ttf = files(`${PASS5}/*-*.ttf`, async ($, output) => {
	await $.need(de(PASS5));
	const [input] = await $.need(Pass4Otd`${PASS4}/${output.name}.otd`);
	await OtfccBuildAsIs(input.full, output.full);
});
const Pass5Group = tasks(`pass5-group::*`, async ($, weight) => {
	const [config] = await $.need(Config);
	await $.need(GroupFileNamesT(config, weight, f => Pass5Ttf(`${PASS5}/${f}.ttf`)));
});
const Ttf = tasks(`ttf`, async $ => {
	const [config] = await $.need(Config);
	await $.need(config.weights.map(w => Pass5Group`pass5-group::${w}`));
});

async function OtfccBuildAsIs(from, to) {
	await run(OTFCCBUILD, from, [`-o`, to], [`-k`, `-s`, `--keep-average-char-width`, `-q`]);
	await rm(from);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Configuration, directories
const Config = oracle("config", async () => {
	return await fs.readJSON(__dirname + "/config.json");
});
const JHint = oracle("hinting-jobs", async () => os.cpus().length);
