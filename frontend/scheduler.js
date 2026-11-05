const processForm = document.querySelector("#process-form");
const burstTimeInput = processForm.elements["burst-time"];
const arrivalTimeInput = processForm.elements["arrival-time"];
const nextProcessName = document.querySelector("#next-process-name");
const processList = document.querySelector("#process-list");
const resultsList = document.querySelector("#results-list");
const averageTurnaroundOutput = document.querySelector("#average-turnaround");
const averageWaitingOutput = document.querySelector("#average-waiting");
const resultsChartMetric = document.querySelector("#results-chart-metric");
const resultsChartList = document.querySelector("#results-chart-list");
const resultsChartScale = document.querySelector("#results-chart-scale");
const policyComparisonList = document.querySelector("#policy-comparison-list");
const ganttSegmentDetails = document.querySelector("#gantt-segment-details");
const clearScheduleButton = document.querySelector("#clear-schedule");
const policyInputs = document.querySelectorAll('input[name="policy"]');
const cycleTimeField = document.querySelector("#cycle-time-field");
const cycleTimeInput = document.querySelector("#cycle-time");
const scheduleStatus = document.querySelector("#schedule-status");
const ganttTable = document.querySelector(".gantt-chart table");
const ganttCaption = ganttTable.querySelector("caption");
const ganttColumns = ganttTable.querySelector("colgroup");
const ganttHeader = ganttTable.tHead.rows[0];
const ganttRow = ganttTable.tBodies[0].rows[0];
const processes = [];
let latestResults = [];
let nextProcessNumber = 1;
const schedulingPolicies = [
	{ value: "fcfs", label: "FCFS" },
	{ value: "sjf", label: "SJF" },
	{ value: "srtf", label: "SRTF" },
	{ value: "round-robin", label: "Round Robin" },
];

function addProcessRow(process) {
	const row = document.createElement("tr");

	for (const value of [process.name, process.burstTime, process.arrivalTime]) {
		const cell = document.createElement("td");
		cell.textContent = value;
		row.append(cell);
	}

	const actionsCell = document.createElement("td");
	const deleteButton = document.createElement("button");
	deleteButton.type = "button";
	deleteButton.className = "delete-process-button";
	deleteButton.textContent = "Delete";
	deleteButton.setAttribute("aria-label", `Delete ${process.name}`);
	deleteButton.addEventListener("click", () => deleteProcess(process));
	actionsCell.append(deleteButton);
	row.append(actionsCell);
	processList.append(row);
}

function showEmptyProcessList() {
	const emptyRow = document.createElement("tr");
	emptyRow.className = "empty-processes";
	const emptyCell = document.createElement("td");
	emptyCell.colSpan = 4;
	emptyCell.textContent = "No processes added yet.";
	emptyRow.append(emptyCell);
	processList.replaceChildren(emptyRow);
}

function deleteProcess(process) {
	const processIndex = processes.findIndex((candidate) => candidate.order === process.order);
	if (processIndex === -1) {
		return;
	}

	const deletedRow = processList.rows[processIndex];
	processes.splice(processIndex, 1);
	deletedRow.remove();
	if (processes.length === 0) {
		showEmptyProcessList();
	}

	updateScheduleViews();
	const nextRow = processList.rows[Math.min(processIndex, processes.length - 1)];
	const nextDeleteButton = nextRow?.querySelector(".delete-process-button");
	(nextDeleteButton ?? document.querySelector("#burst-time")).focus();
}

function appendSegment(segments, process, start, end) {
	const previous = segments.at(-1);
	if (previous && !previous.idle && previous.order === process.order && previous.end === start) {
		previous.end = end;
		return;
	}

	segments.push({
		name: process.name,
		start,
		end,
		order: process.order,
		colorIndex: process.order % 4,
	});
}

function createProcessResult(process, startTime, completionTime) {
	const turnaroundTime = completionTime - process.arrivalTime;
	return {
		name: process.name,
		order: process.order,
		completionTime,
		turnaroundTime,
		waitingTime: turnaroundTime - process.burstTime,
		responseTime: startTime - process.arrivalTime,
	};
}

function calculateNonPreemptiveSchedule(policy) {
	const waiting = [...processes];
	const segments = [];
	const results = [];
	let currentTime = 0;

	while (waiting.length > 0) {
		const ready = waiting.filter((process) => process.arrivalTime <= currentTime);
		if (ready.length === 0) {
			const nextArrival = Math.min(...waiting.map((process) => process.arrivalTime));
			segments.push({ name: "Idle", start: currentTime, end: nextArrival, idle: true });
			currentTime = nextArrival;
			continue;
		}

		ready.sort(policy === "sjf"
			? (first, second) =>
				first.burstTime - second.burstTime ||
				first.arrivalTime - second.arrivalTime ||
				first.order - second.order
			: (first, second) =>
				first.arrivalTime - second.arrivalTime || first.order - second.order);
		const process = ready[0];
		waiting.splice(waiting.indexOf(process), 1);
		const startTime = currentTime;
		currentTime += process.burstTime;
		appendSegment(segments, process, startTime, currentTime);
		results.push(createProcessResult(process, startTime, currentTime));
	}

	return { segments, results: sortResultsByInput(results), totalTime: currentTime };
}

function calculateSRTFSchedule() {
	const remaining = new Map(processes.map((process) => [process.order, process.burstTime]));
	const firstStart = new Map();
	const completionTimes = new Map();
	const segments = [];
	let currentTime = 0;
	let completedCount = 0;

	while (completedCount < processes.length) {
		const ready = processes.filter(
			(process) => process.arrivalTime <= currentTime && remaining.get(process.order) > 0
		);
		if (ready.length === 0) {
			const nextArrival = Math.min(
				...processes
					.filter((process) => remaining.get(process.order) > 0)
					.map((process) => process.arrivalTime)
			);
			segments.push({ name: "Idle", start: currentTime, end: nextArrival, idle: true });
			currentTime = nextArrival;
			continue;
		}

		ready.sort((first, second) =>
			remaining.get(first.order) - remaining.get(second.order) ||
			first.arrivalTime - second.arrivalTime ||
			first.order - second.order);
		const process = ready[0];
		if (!firstStart.has(process.order)) {
			firstStart.set(process.order, currentTime);
		}

		const nextArrival = Math.min(
			...processes
				.filter((candidate) =>
					candidate.arrivalTime > currentTime && remaining.get(candidate.order) > 0
				)
				.map((candidate) => candidate.arrivalTime),
			Infinity
		);
		const runDuration = Math.min(
			remaining.get(process.order),
			nextArrival - currentTime
		);
		const startTime = currentTime;
		currentTime += runDuration;
		remaining.set(process.order, remaining.get(process.order) - runDuration);
		appendSegment(segments, process, startTime, currentTime);

		if (remaining.get(process.order) === 0) {
			completionTimes.set(process.order, currentTime);
			completedCount += 1;
		}
	}

	const results = processes.map((process) =>
		createProcessResult(
			process,
			firstStart.get(process.order),
			completionTimes.get(process.order)
		)
	);
	return { segments, results, totalTime: currentTime };
}

function calculateRoundRobinSchedule(cycleTime) {
	const orderedProcesses = [...processes].sort(
		(first, second) =>
			first.arrivalTime - second.arrivalTime || first.order - second.order
	);
	const remaining = new Map(processes.map((process) => [process.order, process.burstTime]));
	const firstStart = new Map();
	const completionTimes = new Map();
	const segments = [];
	const readyQueue = [];
	let nextProcessIndex = 0;
	let currentTime = 0;

	while (completionTimes.size < processes.length) {
		while (
			nextProcessIndex < orderedProcesses.length &&
			orderedProcesses[nextProcessIndex].arrivalTime <= currentTime
		) {
			readyQueue.push(orderedProcesses[nextProcessIndex]);
			nextProcessIndex += 1;
		}

		if (readyQueue.length === 0) {
			const nextProcess = orderedProcesses[nextProcessIndex];
			segments.push({ name: "Idle", start: currentTime, end: nextProcess.arrivalTime, idle: true });
			currentTime = nextProcess.arrivalTime;
			continue;
		}

		const process = readyQueue.shift();
		if (!firstStart.has(process.order)) {
			firstStart.set(process.order, currentTime);
		}

		const runDuration = Math.min(cycleTime, remaining.get(process.order));
		const startTime = currentTime;
		currentTime += runDuration;
		remaining.set(process.order, remaining.get(process.order) - runDuration);
		appendSegment(segments, process, startTime, currentTime);

		while (
			nextProcessIndex < orderedProcesses.length &&
			orderedProcesses[nextProcessIndex].arrivalTime <= currentTime
		) {
			readyQueue.push(orderedProcesses[nextProcessIndex]);
			nextProcessIndex += 1;
		}

		if (remaining.get(process.order) > 0) {
			readyQueue.push(process);
		} else {
			completionTimes.set(process.order, currentTime);
		}
	}

	const results = processes.map((process) =>
		createProcessResult(
			process,
			firstStart.get(process.order),
			completionTimes.get(process.order)
		)
	);
	return { segments, results, totalTime: currentTime };
}

function sortResultsByInput(results) {
	return results.sort((first, second) => first.order - second.order);
}

function calculateSchedule(policy, cycleTime) {
	switch (policy) {
		case "sjf":
			return calculateNonPreemptiveSchedule("sjf");
		case "srtf":
			return calculateSRTFSchedule();
		case "round-robin":
			return calculateRoundRobinSchedule(cycleTime);
		case "fcfs":
		default:
			return calculateNonPreemptiveSchedule("fcfs");
	}
}

function renderGanttChart(schedule) {
	ganttSegmentDetails.textContent = "Select a timeline block to see when it runs and for how long.";
	const labelColumn = document.createElement("col");
	labelColumn.className = "cpu-label-column";
	ganttColumns.replaceChildren(labelColumn);
	ganttHeader.replaceChildren();
	ganttRow.replaceChildren();

	const cpuHeader = document.createElement("th");
	cpuHeader.scope = "col";
	cpuHeader.textContent = "CPU";
	ganttHeader.append(cpuHeader);

	const cpuRowHeader = document.createElement("th");
	cpuRowHeader.scope = "row";
	cpuRowHeader.textContent = "CPU";
	ganttRow.append(cpuRowHeader);

	if (schedule.segments.length === 0) {
		const column = document.createElement("col");
		column.style.width = "84%";
		ganttColumns.append(column);

		const emptyCell = document.createElement("td");
		emptyCell.className = "empty-chart";
		emptyCell.colSpan = 1;
		emptyCell.textContent = "Add processes to see the schedule.";
		ganttRow.append(emptyCell);
		ganttCaption.textContent = `${schedule.policyName} schedule. Add processes to see the timeline.`;
		return;
	}

	for (const segment of schedule.segments) {
		const duration = segment.end - segment.start;
		const column = document.createElement("col");
		column.style.width = `${(duration / schedule.totalTime) * 84}%`;
		ganttColumns.append(column);

		const timeHeader = document.createElement("th");
		timeHeader.scope = "col";
		timeHeader.textContent = `${segment.start}–${segment.end}`;
		ganttHeader.append(timeHeader);

		const block = document.createElement("td");
		block.classList.add(segment.idle ? "idle-block" : "process-block");
		if (!segment.idle) {
			block.classList.add(`process-color-${segment.colorIndex}`);
		}
		const segmentButton = document.createElement("button");
		segmentButton.type = "button";
		segmentButton.className = "segment-button";
		segmentButton.textContent = segment.name;
		segmentButton.setAttribute(
			"aria-label",
			`${segment.name}, time ${segment.start} to ${segment.end}, ${duration} time units. Select for details.`
		);
		segmentButton.addEventListener("click", () => {
			ganttSegmentDetails.textContent = segment.idle
				? `CPU idle from time ${segment.start} to ${segment.end} (${duration} time units).`
				: `${segment.name} ran from time ${segment.start} to ${segment.end} (${duration} time units).`;
		});
		block.append(segmentButton);
		ganttRow.append(block);
	}

	ganttCaption.textContent = `${schedule.policyName} schedule from time 0 through ${schedule.totalTime}.`;
}

function renderResults(results) {
	latestResults = results;
	resultsList.replaceChildren();

	if (results.length === 0) {
		const emptyRow = document.createElement("tr");
		emptyRow.className = "empty-processes";
		const emptyCell = document.createElement("td");
		emptyCell.colSpan = 5;
		emptyCell.textContent = "Add processes to calculate results.";
		emptyRow.append(emptyCell);
		resultsList.append(emptyRow);
		averageTurnaroundOutput.textContent = "—";
		averageWaitingOutput.textContent = "—";
		renderResultsChart(results);
		return;
	}

	let totalTurnaroundTime = 0;
	let totalWaitingTime = 0;

	for (const result of results) {
		const row = document.createElement("tr");
		for (const value of [
			result.name,
			result.completionTime,
			result.turnaroundTime,
			result.waitingTime,
			result.responseTime,
		]) {
			const cell = document.createElement("td");
			cell.textContent = value;
			row.append(cell);
		}
		resultsList.append(row);
		totalTurnaroundTime += result.turnaroundTime;
		totalWaitingTime += result.waitingTime;
	}

	averageTurnaroundOutput.textContent = (totalTurnaroundTime / results.length).toFixed(2);
	averageWaitingOutput.textContent = (totalWaitingTime / results.length).toFixed(2);
	renderResultsChart(results);
}

function renderResultsChart(results) {
	const metric = resultsChartMetric.value;
	const maximum = Math.max(0, ...results.map((result) => result[metric]));
	const metricLabel = resultsChartMetric.selectedOptions[0].textContent;
	resultsChartList.replaceChildren();

	if (results.length === 0) {
		const emptyItem = document.createElement("li");
		emptyItem.className = "results-chart-empty";
		emptyItem.textContent = "Add processes to compare their times.";
		resultsChartList.append(emptyItem);
		resultsChartScale.lastElementChild.textContent = "—";
		return;
	}

	for (const result of results) {
		const item = document.createElement("li");
		item.className = "results-chart-item";

		const name = document.createElement("span");
		name.className = "results-chart-process";
		name.textContent = result.name;

		const track = document.createElement("span");
		track.className = "results-chart-track";
		track.setAttribute("aria-hidden", "true");

		const bar = document.createElement("span");
		bar.className = "results-chart-bar";
		bar.style.width = `${maximum === 0 ? 0 : (result[metric] / maximum) * 100}%`;
		track.append(bar);

		const value = document.createElement("span");
		value.className = "results-chart-value";
		value.textContent = result[metric];

		item.setAttribute("aria-label", `${result.name}: ${result[metric]} ${metricLabel.toLowerCase()}`);
		item.append(name, track, value);
		resultsChartList.append(item);
	}

	resultsChartScale.lastElementChild.textContent = `${maximum} time units`;
}

function renderPolicyComparison(cycleTime) {
	policyComparisonList.replaceChildren();

	if (processes.length === 0) {
		const row = document.createElement("tr");
		row.className = "empty-processes";
		const cell = document.createElement("td");
		cell.colSpan = 4;
		cell.textContent = "Add processes to compare policies.";
		row.append(cell);
		policyComparisonList.append(row);
		return;
	}

	for (const policy of schedulingPolicies) {
		const row = document.createElement("tr");
		const nameCell = document.createElement("th");
		nameCell.scope = "row";
		nameCell.textContent = policy.label;
		row.append(nameCell);

		if (policy.value === "round-robin" && (!Number.isSafeInteger(cycleTime) || cycleTime < 1)) {
			const unavailableCell = document.createElement("td");
			unavailableCell.colSpan = 3;
			unavailableCell.className = "comparison-unavailable";
			unavailableCell.textContent = "Enter a positive whole-number time quantum.";
			row.append(unavailableCell);
			policyComparisonList.append(row);
			continue;
		}

		const { results } = calculateSchedule(policy.value, cycleTime);
		const averages = ["turnaroundTime", "waitingTime", "responseTime"].map((metric) =>
			results.reduce((total, result) => total + result[metric], 0) / results.length
		);
		for (const average of averages) {
			const cell = document.createElement("td");
			cell.textContent = average.toFixed(2);
			row.append(cell);
		}
		policyComparisonList.append(row);
	}
}

function updateScheduleViews() {
	const selectedPolicy = document.querySelector('input[name="policy"]:checked').value;
	const needsCycleTime = selectedPolicy === "round-robin";
	cycleTimeField.hidden = !needsCycleTime && processes.length === 0;
	cycleTimeInput.required = needsCycleTime;
	cycleTimeInput.setCustomValidity("");

	const cycleTime = cycleTimeInput.valueAsNumber;
	renderPolicyComparison(cycleTime);
	if (needsCycleTime && (!Number.isSafeInteger(cycleTime) || cycleTime < 1)) {
		scheduleStatus.textContent = "Enter a positive whole-number cycle time to calculate the Round Robin schedule.";
		const emptySchedule = {
			segments: [],
			results: [],
			totalTime: 0,
			policyName: "Round Robin",
		};
		renderGanttChart(emptySchedule);
		renderResults(emptySchedule.results);
		return;
	}

	scheduleStatus.textContent = "";
	const schedule = calculateSchedule(selectedPolicy, cycleTime);
	schedule.policyName = {
		fcfs: "FCFS",
		sjf: "SJF",
		srtf: "SRTF",
		"round-robin": `Round Robin (cycle time ${cycleTime})`,
	}[selectedPolicy];
	renderGanttChart(schedule);
	renderResults(schedule.results);
}

for (const policyInput of policyInputs) {
	policyInput.addEventListener("change", updateScheduleViews);
}
resultsChartMetric.addEventListener("change", () => renderResultsChart(latestResults));
cycleTimeInput.addEventListener("input", updateScheduleViews);

processForm.addEventListener("submit", (event) => {
	event.preventDefault();

	if (!processForm.reportValidity()) {
		return;
	}

	const process = {
		name: `P${nextProcessNumber}`,
		burstTime: burstTimeInput.valueAsNumber,
		arrivalTime: arrivalTimeInput.valueAsNumber,
		order: nextProcessNumber - 1,
	};

	if (processes.length === 0) {
		processList.replaceChildren();
	}

	processes.push(process);
	nextProcessNumber += 1;
	addProcessRow(process);
	updateScheduleViews();
	processForm.reset();
	nextProcessName.textContent = `P${nextProcessNumber}`;
	burstTimeInput.focus();
});

clearScheduleButton.addEventListener("click", () => {
	processes.length = 0;
	nextProcessNumber = 1;
	showEmptyProcessList();

	processForm.reset();
	nextProcessName.textContent = "P1";
	updateScheduleViews();
});

updateScheduleViews();
