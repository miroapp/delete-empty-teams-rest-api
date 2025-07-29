/* 
DISCLAIMER:
The content of this project is subject to the Miro Developer Terms of Use: https://miro.com/legal/developer-terms-of-use/
This script is provided only as an example to illustrate how to identify Miro Teams with no Boards within and to remove these empty Teams.
The usage of this script is at the sole discretion and responsibility of the customer and is to be tested thoroughly before running it on Production environments.

Script author: Luis Colman (luis.s@miro.com) | LinkedIn: https://www.linkedin.com/in/luiscolman/
*/

const IS_TEST = true; // Change to false to perform team deletions
const TOKEN = 'YOUR_MIRO_REST_API_TOKEN'; // Replace with your Miro REST API token
const MIRO_ORGANIZATION_ID = 'YOUR_MIRO_ORGANIZATION_ID'; // Replace with your Miro Company ID


/* SCRIPT BEGIN */

/* Variables - BEGIN */
const fs = require('fs');
let getUserErrors = {};
let userObject = {};
let teams = {};
let getIndividualTeamsErrors = {};
let errorRetryCount = 0;
let numberOfRequests = 520;
let numberOfRequestsForDelete = 12;
let affectedTeams = {};
let results = {};
let getBoardsErrors = {};
let teamsToRemove = {};
/* Variables - END */

/* Functions - BEGIN */

/* Function to get the value of a query parameter of a string URL */
function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    const regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return "";
    //return decodeURIComponent(results[2].replace(/\+/g, " "));
    return results[2];
}

/* Functions to hold script execution (to allow replenishing credits when hitting the SCIM API rate limits) */
const delay = ms => new Promise(res => setTimeout(res, ms));
const holdScriptExecution = async (ms) => {
    console.log('**** Rate limit hit - Delaying execution for ' + (ms / 1000) + ' seconds to replenish rate limit credits - Current time: ' + new Date() + ' ***');
    
    let elapsedSeconds = 0;
    const intervalId = setInterval(() => {
        elapsedSeconds++;
        console.log(`${elapsedSeconds} second(s) passed...`);
    }, 1000);

    await delay(ms);
    
    clearInterval(intervalId); // Stop the interval when delay is over
    console.log('**** Resuming script - Current time: ' + new Date() + ' ***');
};

/* Convert JSON to CSV */
function jsonToCsv(jsonData) {
    if (jsonData) {
        let csv = '';
        let headers;
        
        // Get the headers
        if (IS_TEST) { 
            headers = (Object?.keys(jsonData).length > 0 ? Object?.keys(jsonData[Object?.keys(jsonData)[0]]) : ['NO DELETIONS OCCURRED - TEST MODE WAS ON']);
        }
        else {
            headers = (Object?.keys(jsonData).length > 0 ? Object?.keys(jsonData[Object?.keys(jsonData)[0]]) : ['NO DELETIONS OCCURRED - NO DATA TO SHOW']);
        }
        csv += headers.join(',') + '\n';
        
        // Helper function to escape CSV special characters
        const escapeCSV = (value) => {
            if (Array.isArray(value)) {
                // Join array values with a comma followed by a space
                value = value.join(', ');
            }
            if (typeof value === 'string') {
                // Escape double quotes
                if (value.includes('"')) {
                    value = value.replace(/"/g, '""');
                }
            }
            // Wrap the value in double quotes to handle special CSV characters
            value = `"${value}"`;
            return value;
        };
    
        // Add the data
        Object.keys(jsonData).forEach(function(row) {
            let data = headers.map(header => escapeCSV(jsonData[row][header])).join(',');
            csv += data + '\n';
        });

        return csv;
    }
}

/* Function to create reports */
function addReportsForNodeJS() {
    let content;
    let directory = 'miro_teams_deletion_output_files';
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }

    content = JSON.stringify(teams, null, '2');
    filePath = 'miro_teams_deletion_output_files/Miro_Teams_Overview.json';
    fs.writeFileSync(filePath, content);

    content = jsonToCsv(teams);
    filePath = 'miro_teams_deletion_output_files/Miro_Teams_Overview.csv';
    fs.writeFileSync(filePath, content);

    content = JSON.stringify(teamsToRemove, null, '2');
    filePath = 'miro_teams_deletion_output_files/Miro_Teams_to_Delete.json';
    fs.writeFileSync(filePath, content);

    content = jsonToCsv(teamsToRemove);
    filePath = 'miro_teams_deletion_output_files/Miro_Teams_to_Delete.csv';
    fs.writeFileSync(filePath, content);

    content = JSON.stringify(results, null, '2');
    filePath = 'miro_teams_deletion_output_files/Miro_Teams_Deletion_Results.json';
    fs.writeFileSync(filePath, content);

    content = jsonToCsv(results);
    filePath = 'miro_teams_deletion_output_files/Miro_Teams_Deletion_Results.csv';
    fs.writeFileSync(filePath, content);

    if (Object.keys(getIndividualTeamsErrors).length > 0) {
        content = JSON.stringify(getIndividualTeamsErrors, null, '2');
        filePath = 'miro_teams_deletion_output_files/Script_Errors.json';
        fs.writeFileSync(filePath, content);

        content = jsonToCsv(getIndividualTeamsErrors);
        filePath = 'miro_teams_deletion_output_files/Script_Errors.csv';
        fs.writeFileSync(filePath, content);
    }
}

/* Function to call Miro API teams */
async function callAPI(url, options) {
    async function manageErrors(response) {
        if(!response.ok){
            var parsedResponse = await response.json();
            var responseError = {
                status: response.status,
                statusText: response.statusText,
                requestUrl: response.url,
                errorDetails: parsedResponse
            };
            throw(responseError);
        }
        return response;
    }

    var response = await fetch(url, options)
    .then(manageErrors)
    .then((res) => {
        if (res.ok) {
            var rateLimitRemaining = res.headers.get('X-RateLimit-Remaining');
            return res[res.status == 204 ? 'text' : 'json']().then((data) => ({ status: res.status, rate_limit_remaining: rateLimitRemaining, body: data }));
        }
    })
    .catch((error) => {
        console.error('Error:', error);
        return error;
    });
    return response;
}

/* Function to delete teams with no boards within */
async function deleteTeams(numberOfRequestsForDelete) {
    let totalItems;
    let batchUrls;

    let reqHeaders = {
        'cache-control': 'no-cache, no-store',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN
    };

    let reqGetOptions = {
        method: 'DELETE',
        headers: reqHeaders,
        body: null
    };

    totalItems = Object.keys(teamsToRemove);
    getRemainingTeams = {};

    for(let i=0; i < totalItems.length; i++) {
        getRemainingTeams[totalItems[i]] = { team_name: teams[totalItems[i]].team_name, team_id: teams[totalItems[i]].team_id }
    }

    getProcessedTeams = {};
    let processedUrls = [];
    let batchSize;

    while (Object.keys(getRemainingTeams).length > 0) {
        var apiUrl = `https://api.miro.com/v2/orgs/${MIRO_ORGANIZATION_ID}/teams`;
        
        // Calculate the number of items remaining to fetch
        const remainingItems = totalItems.length - (Object.keys(getProcessedTeams).length);

        if (Object.keys(getIndividualTeamsErrors).length === 0) {
            // Calculate the number of calls to make in this batch
            batchSize = Math.min(numberOfRequestsForDelete, Math.ceil(remainingItems / 1));
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${apiUrl}/${Object.keys(getRemainingTeams)[index]}`);
        }
        else {
            console.log('Errors found - retrying failed requests');
            await holdScriptExecution(61000); 
            batchSize = Object.keys(getIndividualTeamsErrors).length;
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${Object.keys(getIndividualTeamsErrors)[index]}`);
            processedUrls.forEach(function(item) {
                let urlIndex = batchUrls.indexOf(item);
                if (urlIndex !== -1) {
                    batchUrls.splice(urlIndex, 1);
                }
            });
            errorRetryCount = errorRetryCount + 1;
            console.log(`errorRetryCount --> ${errorRetryCount}`);
            if (errorRetryCount < 8) {
                if (errorRetryCount === 7) { 
                    console.log('This is the 7th and last attempt to retry failed "getTeamAdmins" calls...');
                }
            }
            else {
                console.log('Maximum amount of retry attempts for failed "deleteTeams" calls reached (7). Please review the "getIndividualTeamsErrors" object to find out what the problem is...');
                return false;
            }
        }
        if (Object.keys(getIndividualTeamsErrors).length > 0) { 
            console.log(`Failed API calls to retry below: -----`); 
        }

        if (batchUrls.length > 0) {

            console.log(`.........API URLs in this the batch are:`);
            console.table(batchUrls);

            try {       
                const promisesWithUrls = batchUrls.map(url => {
                    const promise = fetch(url, reqGetOptions)
                        .catch(error => {
                            // Check if the error is a response error
                            if (error instanceof Response) {
                                // Capture the HTTP error code and throw it as an error
                                let teamId = value.url.replaceAll(`https://api.miro.com/v2/orgs/${MIRO_ORGANIZATION_ID}/teams/`,'');
                                if (!getIndividualTeamsErrors[url]) {
                                    getIndividualTeamsErrors[url] = { team: teamId, url: url, error: error.status, errorMessage: error.statusText };
                                }
                                console.error({ team: teamId, url: url, errorMessage: errorMessage });
                                return Promise.reject(error);
                            } else {
                                // For other types of errors, handle them as usual
                                throw error;
                            }
                        });
                    return { promise, url };
                });

                // Fetch data for each URL in the batch
                const batchResponses = await Promise.allSettled(promisesWithUrls.map(({ promise }) => promise));
                for (let i = 0; i < batchResponses.length; i++) {
                    let { status, value, reason } = batchResponses[i];
                    if (status === 'fulfilled') {
                        let teamId = value.url.replaceAll(`https://api.miro.com/v2/orgs/${MIRO_ORGANIZATION_ID}/teams/`,'');
                        if (value.ok) {
                            errorRetryCount = 0;
                            if (processedUrls.indexOf(value.url) === -1) {
                                results[teamId] = {
                                    team_id: teamId,
                                    team_name: teams[teamId].team_name,
                                    team_type: 'team',
                                    number_of_boards: teams[teamId].number_of_boards,
                                    result: `Team ${teamId} successfully deleted`
                                };
                                teams[teamId].team_type = 'team';
                                teamsToRemove[teamId].team_type = 'team';
                                processedUrls.push(value.url);
                                delete getRemainingTeams[teamId];
                                if (!getProcessedTeams[teamId]) {
                                    getProcessedTeams[teamId] = { team_id: teamId, team_name: teams[teamId].team_name };
                                }
                                if (getIndividualTeamsErrors[value.url]) {
                                    delete getIndividualTeamsErrors[value.url];
                                }
                                console.log(`Team ${teamId} successfully deleted - Team ${Object.keys(getProcessedTeams).length} out of ${totalItems.length}`);
                            }
                        }
                        else if (value.status === 429) {
                            if (!getIndividualTeamsErrors[value.url]) {
                                getIndividualTeamsErrors[value.url] = { team_id: teamId, team_name: teams[teamId].team_name, errorCode: value.status, errorMessage: 'Rate limit reached' };
                            }
                        }
                        else if (value.status === 500) {
                            errorRetryCount = 0;
                            if (processedUrls.indexOf(value.url) === -1) {
                                processedUrls.push(value.url);
                                delete getRemainingTeams[teamId];
                                teams[teamId].team_type = 'developer_team';
                                results[teamId] = {
                                    team_id: teamId,
                                    team_name: teams[teamId].team_name,
                                    team_type: 'developer_team',
                                    number_of_boards: teams[teamId].number_of_boards,
                                    result: `Team ${teamId} skipped - Developer Teams cannot be deleted via API`
                                };
                                teams[teamId].team_type = 'developer_team';
                                teamsToRemove[teamId].team_type = 'developer_team';
                                if (!getProcessedTeams[teamId]) {
                                    getProcessedTeams[teamId] = { team_id: teamId, team_name: teams[teamId].team_name };
                                }
                                if (getIndividualTeamsErrors[value.url]) {
                                    delete getIndividualTeamsErrors[value.url];
                                }
                                console.log(`Team ${teamId} skipped - Developer Teams cannot be deleted via API - Processed teams: ${Object.keys(getProcessedTeams).length} out of ${totalItems.length}`);
                            }
                        }
                        else {
                            let batchData = await value.json();
                            if (!getIndividualTeamsErrors[value.url]) {
                                getIndividualTeamsErrors[value.url] = { team_id: teamId, team_name: teams[teamId].team_name, errorCode: value.status, errorMessage: batchData.message };
                            }
                            console.log(`Error - Could not add Service Account to Team - Processed teams: ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId}`);
                            console.dir(batchData);
                        }
                    }
                    else {
                        let index = batchResponses.indexOf({ status, value, reason });
                        let failedUrl = promisesWithUrls[index].url;
                        let teamId = failedUrl.replaceAll(`https://api.miro.com/v2/orgs/${MIRO_ORGANIZATION_ID}/teams/`,'');
                        if (!getIndividualTeamsErrors[failedUrl]) {
                            [failedUrl] = { team: teamId, url: failedUrl, error: status, errorMessage: value.statusText };
                        }
                        console.error(`Custom Message - API URL --> ${failedUrl}:`, reason);
                    }
                }

            } catch (error) {
                console.error(error);
            }
        }
    }

    for(let i=0; i < Object.keys(teams).length; i++) {
        let teamId = Object.keys(teams)[i];
        let team = teams[teamId];
        if (!teams[teamId]?.team_type) {
            team.team_type = 'team';
        }
    }

    for(let i=0; i < Object.keys(teamsToRemove).length; i++) {
        let teamId = Object.keys(teamsToRemove)[i];
        let team = teams[teamId];
        if (!teamsToRemove[teamId]?.team_type) {
            teamsToRemove[teamId].team_type = 'team';
        }
    }

    return true;
}

/* Function to get Boards */
async function getBoards(numberOfRequests) {
    let totalItems;
    let batchUrls;

    let reqHeaders = {
        'cache-control': 'no-cache, no-store',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN
    };

    let reqGetOptions = {
        method: 'GET',
        headers: reqHeaders,
        body: null
    };

    let initialData = [];
    totalItems = Object.keys(teams);
    getRemainingTeams = {};

    for(let i=0; i < totalItems.length; i++) {
        getRemainingTeams[totalItems[i]] = { team_name: totalItems[i].team_name, team_id: totalItems[i].team_id }
    }

    getProcessedTeams = {};
    let processedUrls = [];
    let batchSize;

    while (Object.keys(getRemainingTeams).length > 0) {
        console.log(`----- Getting number of boards per Team - Remaining ${Object.keys(getRemainingTeams).length}`);
        var apiUrl = `https://api.miro.com/v2/boards`;
        
        // Calculate the number of items remaining to fetch
        const remainingItems = totalItems.length - (Object.keys(getProcessedTeams).length);

        if (Object.keys(getIndividualTeamsErrors).length === 0) {
            // Calculate the number of calls to make in this batch
            batchSize = Math.min(numberOfRequests, Math.ceil(remainingItems / 1));
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${apiUrl}?team_id=${Object.keys(getRemainingTeams)[index]}`);
        }
        else {
            console.log('Errors found - retrying failed requests');
            await holdScriptExecution(61000); 
            batchSize = Object.keys(getIndividualTeamsErrors).length;
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${Object.keys(getIndividualTeamsErrors)[index]}`);
            processedUrls.forEach(function(item) {
                let urlIndex = batchUrls.indexOf(item);
                if (urlIndex !== -1) {
                    batchUrls.splice(urlIndex, 1);
                }
            });
            errorRetryCount = errorRetryCount + 1;
            console.log(`errorRetryCount --> ${errorRetryCount}`);
            if (errorRetryCount < 8) {
                if (errorRetryCount === 7) { 
                    console.log('This is the 7th and last attempt to retry failed "getTeamAdmins" calls...');
                }
            }
            else {
                console.log('Maximum amount of retry attempts for failed "getBoards" calls reached (7). Please review the "getIndividualTeamsErrors" object to find out what the problem is...');
                return false;
            }
        }
        if (Object.keys(getIndividualTeamsErrors).length > 0) { 
            console.log(`Failed API calls to retry below: -----`); 
        }
        if (batchUrls.length > 0) {
            console.log(`.........API URLs in this the batch are:`);
            console.table(batchUrls);
            try {       
                const promisesWithUrls = batchUrls.map(url => {
                    const promise = fetch(url, reqGetOptions)
                        .catch(error => {
                            // Check if the error is a response error
                            if (error instanceof Response) {
                                // Capture the HTTP error code and throw it as an error
                                let teamId = getParameterByName('team_id', value.url);
                                if (!getIndividualTeamsErrors[url]) {
                                    getIndividualTeamsErrors[url] = { team: teamId, url: url, error: error.status, errorMessage: error.statusText };
                                }
                                console.error({ team: teamId, url: url, errorMessage: errorMessage });
                                return Promise.reject(error);
                            } else {
                                // For other types of errors, handle them as usual
                                throw error;
                            }
                        });
                    return { promise, url };
                });

                // Fetch data for each URL in the batch
                const batchResponses = await Promise.allSettled(promisesWithUrls.map(({ promise }) => promise));
                for (let i = 0; i < batchResponses.length; i++) {
                    let { status, value, reason } = batchResponses[i];
                    if (status === 'fulfilled') {
                        let teamId = getParameterByName('team_id', value.url);
                        if (value.ok) {
                            errorRetryCount = 0;
                            if (value.status === 200) {
                                let batchData = await value.json();
                                teams[teamId].number_of_boards = batchData.total;
                                if (batchData.total === 0) {
                                    teamsToRemove[teamId] = { team_id: teamId, team_name: teams[teamId].team_name, number_of_boards: batchData.total };
                                }
                                if (processedUrls.indexOf(value.url) === -1) { 
                                    processedUrls.push(value.url)
                                };
                                delete getRemainingTeams[teamId];
                                if (!getProcessedTeams[teamId]) {
                                    getProcessedTeams[teamId] = { team_id: teamId, team_name: teams[teamId].team_name };
                                }
                                if (getIndividualTeamsErrors[value.url]) {
                                    delete getIndividualTeamsErrors[value.url];
                                }
                                console.log(`Processed teams: ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId}`);
                            }
                        }
                        else if (value.status === 429) {
                            if (!getIndividualTeamsErrors[value.url]) {
                                getIndividualTeamsErrors[value.url] = { team_id: teamId, team_name: teams[teamId].team_name, errorCode: value.status, errorMessage: 'Rate limit reached' };
                            }
                        }
                        else {
                            let batchData = await value.json();
                            if (!getIndividualTeamsErrors[value.url]) {
                                getIndividualTeamsErrors[value.url] = { team_id: teamId, team_name: teams[teamId].team_name, errorCode: value.status, errorMessage: batchData?.message };
                            }
                        }
                    }
                    else {
                        let index = batchResponses.indexOf({ status, value, reason });
                        let failedUrl = promisesWithUrls[index].url;
                        let teamId = getParameterByName('team_id', failedUrl);
                        if (!getIndividualTeamsErrors[failedUrl]) {
                            [failedUrl] = { team: teamId, url: failedUrl, error: status, errorMessage: value.statusText };
                        }
                        console.error(`Custom Message - API URL --> ${failedUrl}:`, reason);
                    }
                }

            }
            catch (error) {
                console.error(error);
            }
        }
    }
    return true;
}

/* Function to get all Teams in the Miro account */
async function getTeams(orgId, cursor) {
    let reqHeaders = {
        'cache-control': 'no-cache, no-store',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN
    };

    let reqGetOptions = {
        method: 'GET',
        headers: reqHeaders,
        body: null
    };

    let url = `https://api.miro.com/v2/orgs/${orgId}/teams` + (cursor ? `?cursor=${cursor}` : '');
    console.log('Getting Miro Teams - API URL --> : ' + url);
    let listTeams = await callAPI(url, reqGetOptions);
    if (listTeams.status === 200) {
        for(let i=0; i < listTeams.body.data.length; i++) {
            let teamId = listTeams.body.data[i].id;
            teams[teamId] = {
                MIRO_ORGANIZATION_ID: orgId,
                team_name: listTeams.body.data[i].name.toString(),
                team_id: teamId.toString()
            };
        }

        if (listTeams.body.cursor) {
            await getTeams(orgId, listTeams.body.cursor);
        }
        else {
            console.log('Getting Miro Teams COMPLETE...');
            await getBoards(numberOfRequests);

            if (Object.keys(getIndividualTeamsErrors).length === 0) {
                console.log('Getting number of boards per team COMPLETE...');
                console.log('Getting number of boards to remove COMPLETE...');

                if (!IS_TEST) {
                    if (Object.keys(teamsToRemove).length > 0) {
                        console.log('Preparing to delete Teams without Boards within...');
                        await deleteTeams(numberOfRequestsForDelete);
                        if (Object.keys(getIndividualTeamsErrors).length === 0) {
                            console.log('Deleting Teams without Boards COMPLETE...');
                        }
                    }
                    else {
                        console.log('There are no Teams without Boards within - Nothing to delete...');
                    }
                }
                else {
                    console.log('TEST MODE ON: Skipping deleting boards...');
                }
            }
            
            addReportsForNodeJS();
            console.log(`Script end time: ${new Date()}`);

            console.log('\n======================================');
            console.log('IMPORTANT: Please review script results within the folder "miro_teams_deletion_output_files" in the directory of this script...');
            console.log('========================================\n');
            
            console.log('********** END OF SCRIPT **********\n\n');
            return true;
        }
    }
    else {
        if (!getIndividualTeamsErrors[url]) {
            getIndividualTeamsErrors[url] = { errorCode: listTeams.status, errorMessage: listTeams?.body?.message };
            console.error(listTeams);
            addReportsForNodeJS();
            return listTeams;
        }
    }
    if (listTeams.rate_limit_remaining === '0') {
        await holdScriptExecution(61000);
    }
}

getTeams(MIRO_ORGANIZATION_ID);
