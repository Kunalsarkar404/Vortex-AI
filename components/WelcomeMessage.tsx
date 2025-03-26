export default function WelcomeMessage() {
    return (
        <div className="flex flex-col justify-center items-center h-full mt-10">
            <div className="bg-white rounded-2xl shadow-sm ring-1 ring-inset ring-gray-200 px-6 py-5 max-w-lg w-full">
                <p className="text-xl font-semibold text-gray-900 mb-2">Welcome to Vortex AI Agent! 👋</p>
                <p className="text-gray-600">What can I help with?</p>
            </div>
        </div>
    )
}