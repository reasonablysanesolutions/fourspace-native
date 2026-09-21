import Foundation

/// Scheduled jobs: agents that run prompts on a schedule, driven by the T3
/// server. Jobs run only while the server runs.
@MainActor
@Observable
final class ScheduledViewModel {
    let harness: HarnessStore

    var jobs: [ScheduledJob] = []
    var runs: [ScheduledRun] = []
    var projects: [T3ProjectShell] = []
    var selectedJobId: String?
    var errorText: String?
    var isLoading = false

    init(harness: HarnessStore) {
        self.harness = harness
    }

    var selectedJob: ScheduledJob? {
        jobs.first { $0.id == selectedJobId }
    }

    var upcoming: [ScheduledJob] {
        jobs.filter { $0.enabled }
            .sorted { ($0.nextRunAt ?? "~") < ($1.nextRunAt ?? "~") }
    }

    var paused: [ScheduledJob] {
        jobs.filter { !$0.enabled }
    }

    func runs(for job: ScheduledJob) -> [ScheduledRun] {
        runs.filter { $0.jobId == job.id }
    }

    func projectTitle(_ id: String) -> String {
        projects.first { $0.id == id }?.title ?? "Unknown project"
    }

    // MARK: - Loading

    func refresh() async {
        guard harness.isConnected else { return }
        isLoading = true
        errorText = nil
        defer { isLoading = false }
        do {
            let jobsJSON = try await harness.rpc("scheduled.listJobs", .object([:]))
            jobs = (jobsJSON["jobs"]?.arrayValue ?? []).map(ScheduledJob.init(json:))
            let runsJSON = try await harness.rpc("scheduled.listRuns", .object(["limit": .number(50)]))
            runs = (runsJSON["runs"]?.arrayValue ?? []).map(ScheduledRun.init(json:))
            if let shell = try? await harness.loadShell() {
                projects = shell.projects
            }
        } catch {
            errorText = error.localizedDescription
        }
    }

    // MARK: - Mutation

    func create(title: String, projectId: String, prompt: String, schedule: ScheduledSchedule) async {
        guard let model = harness.currentModelSelection else {
            errorText = "No model selected."
            return
        }
        do {
            _ = try await harness.rpc("scheduled.createJob", .object([
                "title": .string(title),
                "projectId": .string(projectId),
                "prompt": .string(prompt),
                "modelSelection": model,
                "schedule": schedule.json,
            ]))
            await refresh()
        } catch {
            errorText = error.localizedDescription
        }
    }

    func update(
        _ job: ScheduledJob,
        title: String,
        projectId: String,
        prompt: String,
        schedule: ScheduledSchedule
    ) async {
        guard let model = harness.currentModelSelection else { return }
        do {
            _ = try await harness.rpc("scheduled.updateJob", .object([
                "jobId": .string(job.id),
                "title": .string(title),
                "projectId": .string(projectId),
                "prompt": .string(prompt),
                "modelSelection": model,
                "schedule": schedule.json,
            ]))
            await refresh()
        } catch {
            errorText = error.localizedDescription
        }
    }

    func setEnabled(_ job: ScheduledJob, _ enabled: Bool) async {
        do {
            _ = try await harness.rpc("scheduled.updateJob", .object([
                "jobId": .string(job.id),
                "enabled": .bool(enabled),
            ]))
            await refresh()
        } catch {
            errorText = error.localizedDescription
        }
    }

    func delete(_ job: ScheduledJob) async {
        do {
            _ = try await harness.rpc("scheduled.deleteJob", .object(["jobId": .string(job.id)]))
            if selectedJobId == job.id {
                selectedJobId = nil
            }
            await refresh()
        } catch {
            errorText = error.localizedDescription
        }
    }

    func runNow(_ job: ScheduledJob) async {
        do {
            _ = try await harness.rpc("scheduled.runJobNow", .object(["jobId": .string(job.id)]))
            await refresh()
        } catch {
            errorText = error.localizedDescription
        }
    }
}
