export default {
	extends: ["stylelint-config-standard"],
	rules: {
		"selector-class-pattern": [
			"^(?:editorialist-[a-z0-9\\-_]+|is-[a-z0-9\\-]+)$",
			{
				message: 'All Editorialist classes must use the "editorialist-" prefix.',
				resolveNestedSelectors: true,
			},
		],
		"selector-id-pattern": null,
		"no-descending-specificity": null,
		"color-function-notation": null,
		"alpha-value-notation": null,
	},
};
