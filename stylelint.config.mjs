export default {
	extends: ["stylelint-config-standard"],
	rules: {
		"declaration-no-important": true,
		"no-duplicate-selectors": true,
		"selector-class-pattern": [
			"^(?:editorialist-[a-z0-9\\-_]+|ert-[a-z0-9\\-_]+|rt-[a-z0-9\\-_]+|radial-timeline-[a-z0-9\\-_]+|is-[a-z0-9\\-]+|has-[a-z0-9\\-]+)$",
			{
				message: 'Classes must use an approved namespace: "editorialist-", "ert-", legacy "rt-"/"radial-timeline-", or state prefixes "is-"/"has-".',
				resolveNestedSelectors: true,
			},
		],
		"selector-id-pattern": null,
		"no-descending-specificity": null,
		"color-function-notation": null,
		"alpha-value-notation": null,
	},
};
