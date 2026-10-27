const processForm = document.querySelector("#process-form");
const processNameInput = processForm.elements["process-name"];
const burstTimeInput = processForm.elements["burst-time"];
const arrivalTimeInput = processForm.elements["arrival-time"];
const processList = document.querySelector("#process-list");
const resultsList = document.querySelector("#results-list");
const averageTurnaroundOutput = document.querySelector("#average-turnaround");
const averageWaitingOutput = document.querySelector("#average-waiting");
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

function updateProcessNameValidity() {
	const processName = processNameInput.value.trim();
	const nameExists = processes.some(
		(process) => process.name.toLowerCase() === processName.toLowerCase()
	);
	const errorMessage = processName === ""
		? "Enter a process name."
		: nameExists
			? "A process with this name already exists."
			: "";

	processNameInput.setCustomValidity(errorMessage);
}

function addProcessRow(process) {
	const row = document.createElement("tr");

	for (const value of [process.name, process.burstTime, process.arrivalTime]) {
		const cell = document.createElement("td");
		cell.textContent = value;
		row.append(cell);
	}

	processList.append(row);
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
		block.textContent = segment.name;
		block.setAttribute("aria-label", `${segment.name}, time ${segment.start} to ${segment.end}`);
		ganttRow.append(block);
	}

	ganttCaption.textContent = `${schedule.policyName} schedule from time 0 through ${schedule.totalTime}.`;
}

function renderResults(results) {
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
}

function updateScheduleViews() {
	const selectedPolicy = document.querySelector('input[name="policy"]:checked').value;
	const needsCycleTime = selectedPolicy === "round-robin";
	cycleTimeField.hidden = !needsCycleTime;
	cycleTimeInput.required = needsCycleTime;
	cycleTimeInput.setCustomValidity("");

	const cycleTime = cycleTimeInput.valueAsNumber;
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

processNameInput.addEventListener("input", updateProcessNameValidity);
for (const policyInput of policyInputs) {
	policyInput.addEventListener("change", updateScheduleViews);
}
cycleTimeInput.addEventListener("input", updateScheduleViews);

processForm.addEventListener("submit", (event) => {
	event.preventDefault();
	updateProcessNameValidity();

	if (!processForm.reportValidity()) {
		return;
	}

	const process = {
		name: processNameInput.value.trim(),
		burstTime: burstTimeInput.valueAsNumber,
		arrivalTime: arrivalTimeInput.valueAsNumber,
		order: processes.length,
	};

	if (processes.length === 0) {
		processList.replaceChildren();
	}

	processes.push(process);
	addProcessRow(process);
	updateScheduleViews();
	processForm.reset();
	processNameInput.focus();
});

clearScheduleButton.addEventListener("click", () => {
	processes.length = 0;
	processList.replaceChildren();

	const emptyRow = document.createElement("tr");
	emptyRow.className = "empty-processes";
	const emptyCell = document.createElement("td");
	emptyCell.colSpan = 3;
	emptyCell.textContent = "No processes added yet.";
	emptyRow.append(emptyCell);
	processList.append(emptyRow);

	processForm.reset();
	processNameInput.setCustomValidity("");
	updateScheduleViews();
});

updateScheduleViews();
