const fs = require('fs');
const readFiles = require('read-files-promise');
const mustache = require('mustache');
const utils = require('./utils.js');
const chalk = require('chalk');

/**
 * Generates a report on the status of the tree and runner
 */
class Reporter {
    constructor(tree, runner) {
        this.tree = tree;               // the Tree object to report on
        this.runner = runner;           // the Runner object to report on

        this.htmlReport = "";           // the generated html report is stored here
        this.reportTemplate = null;     // template for html reports

        this.reportPath = null;         // absolute path of report.html being generated by this reporter
        this.reportsDirPath = null;     // absolute path of reports/ directory
        this.datedReportPath = null;    // absolute path of report in reports/ directory with a date in its filename
        this.lastReportPath = null;     // absolute path of the last report (if we're doing a -rerunNotPassed)

        this.timer = null;              // timer that goes off when it's time to re-generate the report
        this.stopped = false;           // true if this Reporter was already stopped

        // Initialize path variables
        this.reportPath = process.cwd() + "/report.html";
        this.reportsDirPath = process.cwd() + "/reports";
    }

    /**
     * Starts the reporter, which generates and writes to disk a new report once every REPORT_GENERATE_FREQUENCY ms
     */
    async start() {
        // Initialize path variables (if they haven't been already)
        if(!this.datedReportPath) {
            this.datedReportPath = this.reportsDirPath + "/" + (new Date()).toISOString().replace(/\..*$/, '').replace('T', '_') + (this.tree.isDebug ? "_debug" : "") + ".html";
        }

        // Load template
        let buffers = await readFiles(['report-template.html'] , {encoding: 'utf8'});
        if(!buffers || !buffers[0]) {
            utils.error("report-template.html not found in this directory");
        }
        this.reportTemplate = buffers[0];

        await this.checkForChanges();
    }

    /**
     * Stops the timer set by start()
     */
    async stop() {
        this.stopped = true;
        if(this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        await this.checkForChanges(); // one final time, to encompass last-second changes
    }

    /**
     * Checks for changes to the report, and if so, writes the new report to disk
     */
    async checkForChanges() {
        let newHtmlReport = this.generateReport();
        if(newHtmlReport != this.htmlReport) {
            this.htmlReport = newHtmlReport;
            await this.onReportChanged();
        }

        if(!this.stopped) {
            const REPORT_GENERATE_FREQUENCY = 1000; // ms
            this.timer = setTimeout(this.checkForChanges, REPORT_GENERATE_FREQUENCY);
        }
    }

    /**
     * Called when the report has changed and needs to be written to disk
     */
    async onReportChanged() {
        // Write the new report to report.html and reports/<datetime>.html
        await new Promise((resolve, reject) => {
            fs.mkdir(this.reportsDirPath, { recursive: true }, (err) => {
                if(err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });

        let reportPromise = new Promise((resolve, reject) => {
            fs.writeFile(this.reportPath, this.htmlReport, (err) => {
                if(err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });

        let dateReportPromise = new Promise((resolve, reject) => {
            fs.writeFile(this.datedReportPath, this.htmlReport, (err) => {
                if(err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });

        await Promise.all[reportPromise, dateReportPromise];
    }

    /**
     * @return {String} The HTML report generated from this.tree and this.runner
     */
    generateReport() {
        if(this.tree.branches.length == 0) {
            return "";
        }
        else {
            let view = {
                treeObj: utils.escapeHtml(this.tree.serialize()),
                runnerObj: utils.escapeHtml(this.runner.serialize())
            }
            return mustache.render(this.reportTemplate, view);
        }
    }

    /**
     * Reads in the given report html file, extracts json, merges it with tree
     */
    async mergeInLastReport(filename) {
        this.lastReportPath = process.cwd() + "/" + filename;
        console.log("Including passed branches from: " + chalk.gray(this.lastReportPath));
        console.log("");

        let fileBuffers = null;
        try {
            fileBuffers = await readFiles([ filename ], {encoding: 'utf8'});
        }
        catch(e) {
            utils.error(`The file ${filename} could not be found`);
        }

        let buffer = fileBuffers[0];
        buffer = this.extractBranchesJson(buffer);

        let json = JSON.parse(JSON.stringify(buffer));
        this.tree.mergeBranchesFromPrevRun(json);
    }

    /**
     * @return {String} The raw tree object extracted from the given html
     * @throws {Error} If there was a problem extracting, or if the JSON is invalid
     */
    extractBranchesJson(htmlReport) {
        const errMsg = "Error parsing the report from last time. Please try another file or do not use -r/-rerunNotPassed.";

        let matches = htmlReport.match(/<meta name="treeObj" content="([^"]*)"/);
        if(matches) {
            let content = matches[1];
            content = utils.unescapeHtml(content);
            try {
                JSON.parse(content);
            }
            catch(e) {
                utils.error(errMsg);
            }

            return content;
        }
        else {
            utils.error(errMsg);
        }
    }
}
module.exports = Reporter;
